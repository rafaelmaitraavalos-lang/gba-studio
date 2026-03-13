import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";

export const maxDuration = 180;

const PL_BASE = "https://api.pixellab.ai/v1";

async function plPost(endpoint: string, body: unknown, apiKey: string) {
  const res = await fetch(`${PL_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`PixelLab ${endpoint} error ${res.status}: ${err}`);
  }
  return res.json();
}

type Keypoint = { x: number; y: number; label?: string };

async function estimateSkeleton(frameBuf: Buffer, apiKey: string): Promise<Keypoint[]> {
  try {
    const data = await plPost("/estimate-skeleton", {
      image: { type: "base64", base64: frameBuf.toString("base64"), format: "png" },
    }, apiKey);
    return (data.skeleton_keypoints ?? data.keypoints ?? []) as Keypoint[];
  } catch {
    return [];
  }
}

async function buildMask(
  keypoints: Keypoint[],
  itemType: string,
  frameW: number,
  frameH: number,
): Promise<Buffer> {
  const pixels = new Uint8Array(frameW * frameH * 4).fill(0);
  for (let i = 3; i < pixels.length; i += 4) pixels[i] = 255;

  const paint = (cx: number, cy: number, radius: number) => {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(frameW, Math.ceil(cx + radius));
    const y1 = Math.min(frameH, Math.ceil(cy + radius));
    for (let r = y0; r < y1; r++) {
      for (let c = x0; c < x1; c++) {
        const idx = (r * frameW + c) * 4;
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = 255;
      }
    }
  };

  const targetLabels: Record<string, string[]> = {
    weapon:    ["right_wrist", "right_hand", "wrist_r", "hand_r", "right_elbow"],
    shield:    ["left_wrist", "left_hand", "wrist_l", "hand_l", "left_elbow"],
    armor:     ["spine", "chest", "torso", "neck", "shoulder"],
    hat:       ["head", "nose", "neck"],
    accessory: ["spine", "chest", "neck"],
  };

  const labels = targetLabels[itemType] ?? targetLabels.accessory;
  const matched = keypoints.filter((kp) =>
    labels.some((l) => (kp.label ?? "").toLowerCase().includes(l)),
  );

  if (matched.length > 0) {
    for (const kp of matched) paint(kp.x, kp.y, 14);
  } else {
    const fallback: Record<string, [number, number, number, number]> = {
      weapon:    [Math.floor(frameW * 0.45), Math.floor(frameH * 0.35), Math.floor(frameW * 0.55), Math.floor(frameH * 0.5)],
      shield:    [0,                          Math.floor(frameH * 0.35), Math.floor(frameW * 0.4),  Math.floor(frameH * 0.45)],
      armor:     [Math.floor(frameW * 0.2),  Math.floor(frameH * 0.3),  Math.floor(frameW * 0.6),  Math.floor(frameH * 0.5)],
      hat:       [Math.floor(frameW * 0.15), Math.floor(frameH * 0.05), Math.floor(frameW * 0.7),  Math.floor(frameH * 0.3)],
      accessory: [Math.floor(frameW * 0.1),  Math.floor(frameH * 0.1),  Math.floor(frameW * 0.8),  Math.floor(frameH * 0.8)],
    };
    const [x, y, w, h] = fallback[itemType] ?? fallback.accessory;
    for (let r = y; r < y + h; r++) {
      for (let c = x; c < x + w; c++) {
        const idx = (r * frameW + c) * 4;
        pixels[idx] = pixels[idx + 1] = pixels[idx + 2] = 255;
      }
    }
  }

  return sharp(Buffer.from(pixels), { raw: { width: frameW, height: frameH, channels: 4 } })
    .png()
    .toBuffer();
}

async function inpaintFrame(
  frameBuf: Buffer,
  maskBuf: Buffer,
  description: string,
  apiKey: string,
  frameW: number,
  frameH: number,
): Promise<Buffer> {
  const data = await plPost("/inpaint", {
    description,
    negative_description: "background, floor, ground, scenery, extra limbs",
    image_size: { width: frameW, height: frameH },
    text_guidance_scale: 4.0,
    outline: "single color black outline",
    shading: "detailed shading",
    detail: "highly detailed",
    view: "low top-down",
    inpainting_image: { type: "base64", base64: frameBuf.toString("base64"), format: "png" },
    mask_image:       { type: "base64", base64: maskBuf.toString("base64"),  format: "png" },
  }, apiKey);
  return Buffer.from((data as { image: { base64: string } }).image.base64, "base64");
}

/** Strip data URI prefix and return raw base64. */
function toRawBase64(input: string): string {
  return input.replace(/^data:[^;]+;base64,/, "");
}

/** Load a base64 string (with or without data URI prefix) into a Buffer. */
function base64ToBuffer(input: string): Buffer {
  return Buffer.from(toRawBase64(input), "base64");
}

async function processIdleFrame(
  imageB64: string,
  itemType: string,
  inpaintDesc: string,
  apiKey: string,
): Promise<string> {
  const frameBuf = base64ToBuffer(imageB64);
  const meta = await sharp(frameBuf).metadata();
  const frameW = meta.width  ?? 64;
  const frameH = meta.height ?? 64;
  const keypoints = await estimateSkeleton(frameBuf, apiKey);
  const maskBuf = await buildMask(keypoints, itemType, frameW, frameH);
  const result = await inpaintFrame(frameBuf, maskBuf, inpaintDesc, apiKey, frameW, frameH);
  return result.toString("base64");
}

/**
 * Extract the first frame of each direction row from a spritesheet.
 * Spritesheet: 4 rows × N cols. Row order: south=0, west=1, east=2, north=3.
 * Returns raw base64 per direction.
 */
async function extractIdleFrames(sheetBuf: Buffer): Promise<{ south: string; west: string; east: string; north: string }> {
  const meta = await sharp(sheetBuf).metadata();
  const W = meta.width  ?? 576;
  const H = meta.height ?? 256;
  const frameH = Math.floor(H / 4);
  const frameW = Math.floor(W / 9); // assume 9 cols; first col = idle frame

  const rows = [0, 1, 2, 3]; // south, west, east, north
  const [south, west, east, north] = await Promise.all(
    rows.map((row) =>
      sharp(sheetBuf)
        .extract({ left: 0, top: row * frameH, width: frameW, height: frameH })
        .png()
        .toBuffer()
        .then((b) => b.toString("base64")),
    ),
  );
  return { south, west, east, north };
}

export async function POST(req: NextRequest) {
  const body = await req.json() as {
    // New format: 4 individual direction images (base64 with or without data URI prefix)
    southImage?:  string;
    westImage?:   string;
    eastImage?:   string;
    northImage?:  string;
    // Legacy format: full spritesheet URL or data URI
    characterSpritesheetUrl?: string;
    // Common
    itemDescription:   string;
    itemType?:         string;
    characterDescription?: string;
  };

  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing PixelLab API key" }, { status: 500 });
  if (!body.itemDescription) return NextResponse.json({ error: "Missing itemDescription" }, { status: 400 });

  const resolvedItemType = ["weapon", "shield", "armor", "hat"].includes(body.itemType ?? "")
    ? body.itemType!
    : "accessory";
  const charDesc = body.characterDescription ?? "GBA RPG character, chibi proportions, top-down view";
  const inpaintDesc = `${charDesc}, holding ${body.itemDescription}, GBA pixel art RPG style, top-down view`;

  try {
    let south: string, west: string, east: string, north: string;

    if (body.southImage && body.westImage && body.eastImage && body.northImage) {
      // New format: 4 individual images provided directly
      south = body.southImage;
      west  = body.westImage;
      east  = body.eastImage;
      north = body.northImage;
    } else if (body.characterSpritesheetUrl) {
      // Legacy format: extract idle frames from spritesheet
      const sheetBuf = body.characterSpritesheetUrl.startsWith("data:")
        ? Buffer.from(toRawBase64(body.characterSpritesheetUrl), "base64")
        : Buffer.from(await (await fetch(body.characterSpritesheetUrl)).arrayBuffer());
      const extracted = await extractIdleFrames(sheetBuf);
      south = extracted.south;
      west  = extracted.west;
      east  = extracted.east;
      north = extracted.north;
    } else {
      return NextResponse.json({ error: "Provide either 4 direction images or characterSpritesheetUrl" }, { status: 400 });
    }

    // Inpaint all 4 idle frames in parallel
    const [equippedSouth, equippedWest, equippedEast, equippedNorth] = await Promise.all([
      processIdleFrame(south, resolvedItemType, inpaintDesc, apiKey),
      processIdleFrame(west,  resolvedItemType, inpaintDesc, apiKey),
      processIdleFrame(east,  resolvedItemType, inpaintDesc, apiKey),
      processIdleFrame(north, resolvedItemType, inpaintDesc, apiKey),
    ]);

    return NextResponse.json({
      south: equippedSouth,
      west:  equippedWest,
      east:  equippedEast,
      north: equippedNorth,
      itemDescription: body.itemDescription,
      itemType: resolvedItemType,
    });
  } catch (err) {
    console.error("[generate-equipped] Error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
