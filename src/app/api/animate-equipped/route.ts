import { NextRequest, NextResponse } from "next/server";
import { stitchSpritesheet } from "@/lib/pixellab";

export const maxDuration = 180;

const PL_V1 = "https://api.pixellab.ai/v1";

async function animateWithText(
  referenceB64: string,
  direction: string,
  itemDescription: string,
  characterDescription: string,
  apiKey: string,
): Promise<string[]> {
  const res = await fetch(`${PL_V1}/animate-with-text`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      description: `${characterDescription}, holding ${itemDescription}`,
      action: "walking, legs alternating, left and right foot stepping forward in turn, walk cycle",
      reference_image: { type: "base64", base64: referenceB64 },
      image_size: { width: 64, height: 64 },
      n_frames: 4,
      view: "low top-down",
      direction,
      image_guidance_scale: 1.5,
      negative_description: "background, grey background, solid background, scenery, environment",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PixelLab animate-with-text error ${res.status}: ${text}`);
  }

  const data = await res.json() as { images: { base64: string }[] };
  return data.images.map((img) => img.base64);
}

/** Strip data URI prefix and return raw base64. */
function toRawBase64(input: string): string {
  return input.replace(/^data:[^;]+;base64,/, "");
}

export async function POST(req: NextRequest) {
  const {
    southEquipped,
    westEquipped,
    eastEquipped,
    northEquipped,
    itemDescription,
    characterDescription,
  } = await req.json() as {
    southEquipped: string;
    westEquipped:  string;
    eastEquipped:  string;
    northEquipped: string;
    itemDescription:    string;
    characterDescription?: string;
  };

  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing PixelLab API key" }, { status: 500 });
  if (!southEquipped || !westEquipped || !eastEquipped || !northEquipped || !itemDescription) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const charDesc = characterDescription ?? "GBA RPG character, chibi proportions, top-down view";

  // Each direction uses its own matching reference image — required by animate-with-text
  const directionMap = [
    { direction: "south", imageB64: toRawBase64(southEquipped) },
    { direction: "west",  imageB64: toRawBase64(westEquipped)  },
    { direction: "east",  imageB64: toRawBase64(eastEquipped)  },
    { direction: "north", imageB64: toRawBase64(northEquipped) },
  ] as const;

  try {
    // Animate all 4 directions in parallel, each with its own matching reference image
    const results = await Promise.allSettled(
      directionMap.map(({ direction, imageB64 }) =>
        animateWithText(imageB64, direction, itemDescription, charDesc, apiKey),
      ),
    );

    const rows: string[][] = results.map((result, i) => {
      if (result.status === "fulfilled" && result.value.length > 0) {
        return result.value;
      }
      // Fallback: repeat the static idle frame 4 times
      console.warn(`[animate-equipped] ${directionMap[i].direction} animation failed — using static fallback`);
      return [directionMap[i].imageB64, directionMap[i].imageB64, directionMap[i].imageB64, directionMap[i].imageB64];
    });

    const buf = await stitchSpritesheet(rows, 64);
    const spritesheetUrl = `data:image/png;base64,${buf.toString("base64")}`;

    return NextResponse.json({ spritesheetUrl });
  } catch (err) {
    console.error("[animate-equipped] Error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
