import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { stitchSpritesheet, type PlImage } from "@/lib/pixellab";

export const maxDuration = 180;

const DIRS = ["south", "west", "east", "north"] as const;

/**
 * Remove near-white background pixels from a 64×64 PNG frame.
 * Any pixel with R, G, and B all > 240 is made fully transparent.
 * Returns raw base64 of the cleaned PNG.
 */
async function removeWhiteBackground(b64: string, threshold = 250): Promise<string> {
  const buf = Buffer.from(b64, "base64");
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Uint8Array(data);
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i] > threshold && pixels[i + 1] > threshold && pixels[i + 2] > threshold) {
      pixels[i + 3] = 0; // set alpha to transparent
    }
  }

  const cleaned = await sharp(Buffer.from(pixels), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  return cleaned.toString("base64");
}

export async function POST(req: NextRequest) {
  const {
    characterName,
    equippedItems,
    directionFrames,        // { south: rawB64, west: rawB64, east: rawB64, north: rawB64 }
    characterSpritesheet,   // legacy fallback field
    placement,              // e.g. "right hip", "sheathed on back", custom string
  } = (await req.json()) as {
    characterName: string;
    equippedItems: { slot: string; name: string }[];
    directionFrames?: Record<string, string>;
    characterSpritesheet?: string | null;
    placement?: string;
  };

  const pixellabKey    = process.env.PIXELLAB_API_KEY;
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;

  const itemNames    = equippedItems.map((i) => i.name).join(", ");
  const placementStr = placement?.trim() || "right hip";
  const action       = `natural walking cycle, feet stepping naturally, only add ${itemNames} ${placementStr} to the character's appearance, preserve the original walking animation style`;

  console.log(`[generate-equipped] characterName="${characterName}" items="${itemNames}"`);

  // ── Step 1: PixelLab animate-with-text-v2 (one call per direction) ──────────
  if (pixellabKey && directionFrames) {
    const rows: string[][] = [];

    for (const dir of DIRS) {
      const refB64 = directionFrames[dir];
      if (!refB64) {
        console.warn(`[generate-equipped] missing frame for direction "${dir}" — skipping`);
        rows.push([]);
        continue;
      }

      const dirAction = dir === "south"
        ? `walking forward facing the camera, feet stepping forward and back, ${itemNames} on character, preserve front-facing pose, do not rotate character sideways`
        : action;
      const dirBody: Record<string, unknown> = {
        reference_image:      { type: "base64", base64: refB64, format: "png" },
        reference_image_size: { width: 64, height: 64 },
        action:               dirAction,
        image_size:           { width: 64, height: 64 },
        no_background:        false,
      };
      if (dir === "south") dirBody.image_guidance_scale = 0.9;

      console.log(`[generate-equipped] animate-with-text-v2 dir=${dir} guidance=${dir === "south" ? 0.9 : "default"} refB64_len=${refB64.length} refB64_prefix=${refB64.slice(0, 12)}`);

      try {
        // Use fetch directly so we can log the full response body on non-200
        const res = await fetch("https://api.pixellab.ai/v2/animate-with-text-v2", {
          method:  "POST",
          headers: {
            Authorization:  `Bearer ${pixellabKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(dirBody),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error(`[generate-equipped] dir=${dir} PixelLab HTTP ${res.status} ${res.statusText}: ${errBody}`);
          rows.push([]);
          continue;
        }

        const data = (await res.json()) as { images?: PlImage[] };
        console.log(`[generate-equipped] dir=${dir} raw response keys: ${Object.keys(data).join(", ")} images_count=${data.images?.length ?? 0}`);

        const frames = await Promise.all(
          (data.images ?? [])
            .slice(0, 8)
            .map(async (f) => {
              const raw = f.base64.startsWith("data:")
                ? f.base64.replace(/^data:[^;]+;base64,/, "")
                : f.base64;
              return removeWhiteBackground(raw);
            }),
        );

        console.log(`[generate-equipped] dir=${dir} → ${frames.length} frames after bg removal`);
        rows.push(frames);
      } catch (err) {
        console.error(`[generate-equipped] dir=${dir} threw: ${(err as Error).message}`);
        rows.push([]);
      }
    }

    if (rows.some((r) => r.length > 0)) {
      const buf = await stitchSpritesheet(rows);
      return NextResponse.json({ image: `data:image/png;base64,${buf.toString("base64")}` });
    }

    console.warn("[generate-equipped] animate-with-text-v2 returned no frames for any direction — falling back to Replicate");
  }

  // ── Step 2: Claude prompt enhancement (Replicate fallback path) ─────────────
  let enhancedPrompt = `${characterName} character wearing ${itemNames}, GBA RPG pixel art, 4-direction walk cycle`;

  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 350,
        system: `You are a GBA pixel art RPG character designer. Given a character name and equipped items, write an enhanced prompt for a pixel art walk cycle spritesheet generator. The character should look like a GBA RPG protagonist (Zelda, Fire Emblem, Final Fantasy Tactics Advance style), clearly wearing and holding the described equipment. Include specific visual details about colors, materials, and silhouette. Return only the enhanced prompt, no other text.`,
        messages: [{ role: "user", content: `Character: "${characterName}"\nEquipped: ${itemNames}` }],
      });
      if (msg.content[0].type === "text") enhancedPrompt = msg.content[0].text.trim();
    } catch (err) {
      console.warn("[generate-equipped] Claude failed:", (err as Error).message);
    }
  }

  enhancedPrompt = `${enhancedPrompt}, fully clothed, wearing outfit, dressed`;

  // ── Step 3: Replicate fallback ──────────────────────────────────────────────
  if (!replicateToken) {
    return NextResponse.json({ error: "No generation service available" }, { status: 500 });
  }

  console.log("[generate-equipped] pipeline: Replicate fallback");
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      version: "retro-diffusion/rd-animation",
      input: {
        prompt: enhancedPrompt,
        style: "four_angle_walking",
        width: 64,
        height: 64,
        return_spritesheet: true,
        negative_prompt: "naked, nude, bare skin, undressed",
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json({ error: `Replicate error: ${response.status} – ${text}` }, { status: 500 });
  }

  const prediction = await response.json();
  const outputUrl = prediction.output?.[0] as string | undefined;
  if (!outputUrl) return NextResponse.json({ error: "No image generated" }, { status: 500 });

  const buf = Buffer.from(await (await fetch(outputUrl)).arrayBuffer());
  return NextResponse.json({ image: `data:image/png;base64,${buf.toString("base64")}` });
}
