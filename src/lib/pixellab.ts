/**
 * Shared PixelLab API helpers.
 * All image values exchanged with the API are raw base64 (no data: URI prefix).
 * Spritesheet layout (matching rd-animation four_angle_walking):
 *   Row 0 = south (facing down)
 *   Row 1 = west  (facing left)
 *   Row 2 = east  (facing right)
 *   Row 3 = north (facing up)
 * Each row has 4 animation frames (columns 0-3).
 */

import sharp from "sharp";

const PIXELLAB_BASE = "https://api.pixellab.ai/v1";

export interface PlImage { type: "base64"; base64: string }

/** POST to a PixelLab endpoint and throw on HTTP error. */
export async function plPost(
  endpoint: string,
  body: object,
  apiKey: string,
): Promise<Response> {
  const res = await fetch(`${PIXELLAB_BASE}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PixelLab ${endpoint} error ${res.status}: ${text}`);
  }
  return res;
}

/**
 * Stitch a 4×4 grid of 64×64 frames into a single 256×256 spritesheet.
 * rows[r][c] = raw base64 PNG.  Missing frames fall back to the first frame of that row.
 */
export async function stitchSpritesheet(
  rows: string[][],
  frameSize = 64,
): Promise<Buffer> {
  const numCols = 4;
  const numRows = 4;
  const W = numCols * frameSize;
  const H = numRows * frameSize;

  const composites: { input: Buffer; left: number; top: number }[] = [];

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const b64 = rows[r]?.[c] ?? rows[r]?.[0];
      if (!b64) continue;
      composites.push({
        input: Buffer.from(b64, "base64"),
        left: c * frameSize,
        top: r * frameSize,
      });
    }
  }

  return sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Generate a 4-direction walk-cycle spritesheet using PixelLab.
 * If referenceB64 is provided it is used directly; otherwise a reference is
 * generated first with BitForge (south-facing, 64×64).
 * Returns a data URI string.
 */
export async function generateWalkSpritesheet(
  description: string,
  apiKey: string,
  referenceB64?: string, // raw base64, no data URI prefix
): Promise<string> {
  // ── Step 1: Get or generate reference image ──────────────────────────────
  let refB64 = referenceB64;
  if (!refB64) {
    // BitForge is the right model here: it exposes outline/shading/detail
    // controls purpose-built for pixel art sprites (vs Pixflux which is
    // better for large scenes).
    const refRes = await plPost(
      "/generate-image-bitforge",
      {
        description,
        image_size: { width: 64, height: 64 },
        // "low top-down" matches the GBA RPG camera angle: slight overhead
        // so you see the character's face when south-facing, back when north.
        view: "low top-down",
        direction: "south",
        outline: "single color black outline", // crisp GBA sprite silhouette
        shading: "detailed shading",           // richer than "medium shading"
        detail: "highly detailed",
      },
      apiKey,
    );
    const refData = (await refRes.json()) as { image: PlImage };
    refB64 = refData.image.base64;
  }

  const refImg: PlImage = { type: "base64", base64: refB64 };

  // ── Step 2: Animate 4 directions in parallel ──────────────────────────────
  // Row order: south, west, east, north  (matches rd-animation four_angle_walking)
  const DIRS = ["south", "west", "east", "north"] as const;

  const animResults = await Promise.all(
    DIRS.map((dir) =>
      plPost(
        "/animate-with-text",
        {
          description,
          action: "walking",
          reference_image: refImg,
          image_size: { width: 64, height: 64 },
          n_frames: 4,
          view: "low top-down",   // consistent GBA overhead angle per direction
          direction: dir,
          // Default image_guidance_scale is 1.4 (very loose).
          // 3.0 keeps animation frames much closer to the reference character.
          image_guidance_scale: 3.0,
        },
        apiKey,
      ).then((r) => r.json() as Promise<{ images: PlImage[] }>),
    ),
  );

  // ── Step 3: Stitch into 256×256 spritesheet ───────────────────────────────
  const rows = animResults.map((r) => r.images.map((img) => img.base64));
  const buf = await stitchSpritesheet(rows);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

/** Strip a data URI prefix and return raw base64. */
export function stripDataUri(dataUri: string): string {
  return dataUri.replace(/^data:[^;]+;base64,/, "");
}

/** Extract the top-left 64×64 frame from a spritesheet buffer. */
export async function extractFirstFrame(
  spritesheetBuf: Buffer,
  frameSize = 64,
): Promise<string> {
  const buf = await sharp(spritesheetBuf)
    .extract({ left: 0, top: 0, width: frameSize, height: frameSize })
    .toBuffer();
  return buf.toString("base64");
}
