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

  // Allocate a fully-transparent RGBA canvas and composite frames onto it.
  // sharp({ create: { background: { alpha: 0 } } }) is unreliable for
  // transparency in some versions; raw-buffer input is explicit and correct.
  const rawCanvas = Buffer.alloc(W * H * 4, 0); // all zeros → alpha = 0
  return sharp(rawCanvas, { raw: { width: W, height: H, channels: 4 } })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Generate a 4-direction walk-cycle spritesheet using PixelLab.
 *
 * Flow:
 *   1. BitForge  → south-facing 64×64 reference (transparent bg)
 *   2. Rotate ×3 → west / east / north images derived from that same base
 *   3. animate-with-text ×4 → 4 walk frames per directional image
 *   4. Stitch all 16 frames into a 256×256 spritesheet
 *
 * All 4 rotations derive from the same BitForge image, so the character
 * looks consistent across every direction.
 *
 * If referenceB64 is provided (e.g. from generate-equipped) it is used as
 * the south-facing base and step 1 is skipped.
 */
export async function generateWalkSpritesheet(
  description: string,
  apiKey: string,
  referenceB64?: string, // raw base64, no data URI prefix — skips BitForge step
): Promise<string> {
  // ── Step 1: South-facing base image ──────────────────────────────────────
  let southB64 = referenceB64;
  if (!southB64) {
    const res = await plPost(
      "/generate-image-bitforge",
      {
        description,
        image_size: { width: 64, height: 64 },
        view: "low top-down",
        direction: "south",
        outline: "single color black outline",
        shading: "detailed shading",
        detail: "highly detailed",
        no_background: true,
      },
      apiKey,
    );
    southB64 = ((await res.json()) as { image: PlImage }).image.base64;
  }

  // ── Step 2: Rotate to west / east / north in parallel ────────────────────
  const [westB64, eastB64, northB64] = await Promise.all(
    (["west", "east", "north"] as const).map((toDir) =>
      plPost(
        "/rotate",
        {
          image_size: { width: 64, height: 64 },
          from_image: { type: "base64", base64: southB64 } as PlImage,
          from_view: "low top-down",
          to_view: "low top-down",
          from_direction: "south",
          to_direction: toDir,
          image_guidance_scale: 3.0,
        },
        apiKey,
      ).then((r) => r.json() as Promise<{ image: PlImage }>)
       .then((d) => d.image.base64),
    ),
  );

  // Row order: south(0), west(1), east(2), north(3)
  const dirImages = [southB64, westB64, eastB64, northB64];
  const DIRS     = ["south",   "west",  "east",  "north"] as const;

  // ── Step 3: Animate each directional image → 4 walk frames ───────────────
  const animResults = await Promise.all(
    dirImages.map((imgB64, i) =>
      plPost(
        "/animate-with-text",
        {
          description,
          // Explicit walk cycle action — the more specific, the better the leg movement
          action: "walking, legs alternating, left and right foot stepping forward in turn, walk cycle",
          reference_image: { type: "base64", base64: imgB64 } as PlImage,
          image_size: { width: 64, height: 64 },
          n_frames: 4,
          view: "low top-down",
          direction: DIRS[i],
          // image_guidance_scale default is 1.4.  We previously used 3.0 which
          // anchored the model so tightly to the static reference that legs
          // couldn't move at all.  1.5 keeps the character on-model while
          // still allowing limb animation.
          image_guidance_scale: 1.5,
          // animate-with-text has no no_background param; negative_description
          // is the only lever to suppress backgrounds on animation frames
          negative_description: "background, grey background, solid background, scenery, environment",
        },
        apiKey,
      ).then((r) => r.json() as Promise<{ images: PlImage[] }>),
    ),
  );

  // ── Step 4: Stitch 16 frames into 256×256 spritesheet ────────────────────
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
