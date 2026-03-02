/**
 * Shared PixelLab API helpers.
 *
 * Spritesheet layout (matching rd-animation four_angle_walking convention):
 *   Row 0 = south (facing down)
 *   Row 1 = west  (facing left)
 *   Row 2 = east  (facing right)
 *   Row 3 = north (facing up)
 * Each row has 4 animation frames (columns 0-3) → 256×256 total.
 */

import sharp from "sharp";

// ─── Base URLs ────────────────────────────────────────────────────────────────

const PIXELLAB_V1 = "https://api.pixellab.ai/v1";
const PIXELLAB_V2 = "https://api.pixellab.ai/v2";

// ─── Shared types ─────────────────────────────────────────────────────────────

export interface PlImage { type: "base64"; base64: string }

// ─── V1 helpers ───────────────────────────────────────────────────────────────

/** POST to a PixelLab v1 endpoint and throw on HTTP error. */
export async function plPost(
  endpoint: string,
  body: object,
  apiKey: string,
): Promise<Response> {
  const res = await fetch(`${PIXELLAB_V1}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PixelLab v1 ${endpoint} error ${res.status}: ${text}`);
  }
  return res;
}

// ─── V2 helpers ───────────────────────────────────────────────────────────────

async function v2Post(path: string, body: object, apiKey: string): Promise<Response> {
  const res = await fetch(`${PIXELLAB_V2}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PixelLab v2 POST ${path} error ${res.status}: ${text}`);
  }
  return res;
}

async function v2Get(path: string, apiKey: string): Promise<Response> {
  const res = await fetch(`${PIXELLAB_V2}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PixelLab v2 GET ${path} error ${res.status}: ${text}`);
  }
  return res;
}

/**
 * Poll a background job every 3 s until status === 'completed'.
 * Throws on failure status or timeout (default 3 minutes).
 */
async function pollJob(
  jobId: string,
  apiKey: string,
  timeoutMs = 180_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 3000));
    const res = await v2Get(`/background-jobs/${jobId}`, apiKey);
    const job = (await res.json()) as { status: string; error?: string };
    console.log(`[pixellab-v2] job ${jobId} → ${job.status}`);
    if (job.status === "completed") return;
    if (job.status === "failed")
      throw new Error(`Job ${jobId} failed: ${job.error ?? "unknown"}`);
  }
  throw new Error(`Job ${jobId} timed out after 3 minutes`);
}

/** Fetch an image URL and return raw base64. */
async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image ${url}: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

/** Accept either a URL string or a base64 string from the character response. */
async function resolveImage(value: unknown): Promise<string | null> {
  if (typeof value === "string") {
    if (value.startsWith("http")) return urlToBase64(value);
    if (value.length > 100) return value; // already raw base64
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (typeof v.url === "string") return urlToBase64(v.url);
    if (typeof v.base64 === "string") return v.base64;
  }
  return null;
}

// ─── Shared spritesheet stitcher ──────────────────────────────────────────────

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
  // transparency; raw-buffer input with all-zero bytes is explicit and correct.
  const rawCanvas = Buffer.alloc(W * H * 4, 0); // all zeros → alpha = 0
  return sharp(rawCanvas, { raw: { width: W, height: H, channels: 4 } })
    .composite(composites)
    .png()
    .toBuffer();
}

// ─── V2 character pipeline ────────────────────────────────────────────────────

/**
 * Generate a 4-direction spritesheet using the PixelLab V2 API.
 *
 * Flow:
 *   1. POST /v2/create-character-with-4-directions → character_id + create job_id
 *   2. Poll create job until completed
 *   3. GET /v2/characters/{character_id} → rotation_urls.{south,west,east,north}
 *   4. Fetch each URL and convert to base64
 *   5. Stitch 4×4 spritesheet (each direction image tiled across 4 columns)
 *
 * Walk animation (animation_count > 0) is not yet wired up — static frames only.
 * Returns a data URI string.
 */
export async function generateWalkSpritesheetV2(
  description: string,
  apiKey: string,
): Promise<string> {
  // ── Step 1: Create character with 4 directions ──────────────────────────────
  const createRes = await v2Post(
    "/create-character-with-4-directions",
    {
      description,
      image_size: { width: 64, height: 64 },
      view: "low top-down",
    },
    apiKey,
  );
  const createData = (await createRes.json()) as {
    character_id: string;
    background_job_id: string;
  };
  const { character_id, background_job_id: createJobId } = createData;
  console.log(`[pixellab-v2] character_id=${character_id} create_job=${createJobId}`);

  // ── Step 2: Wait for create job to finish ───────────────────────────────────
  await pollJob(createJobId, apiKey);
  console.log("[pixellab-v2] create job complete");

  // ── Step 3: Fetch character data ─────────────────────────────────────────────
  const charRes = await v2Get(`/characters/${character_id}`, apiKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const charData = (await charRes.json()) as Record<string, any>;
  console.log(
    "[pixellab-v2] GET /characters raw response:\n",
    JSON.stringify(charData, null, 2),
  );

  // ── Step 4: Extract rotation_urls and fetch each as base64 ──────────────────
  const DIR_ORDER = ["south", "west", "east", "north"] as const;
  const rotationUrls: Record<string, string> = charData.rotation_urls ?? {};

  const rows: string[][] = [];
  for (const dir of DIR_ORDER) {
    const url = rotationUrls[dir];
    if (!url) {
      console.warn(`[pixellab-v2] no rotation_url for direction '${dir}'`);
      rows.push([]);
      continue;
    }
    const b64 = await urlToBase64(url);
    // Tile the single static frame across all 4 columns
    rows.push([b64, b64, b64, b64]);
  }

  if (rows.every((r) => r.length === 0)) {
    throw new Error(
      "[pixellab-v2] No rotation_urls found in character response. " +
        "Check the logged raw response above.",
    );
  }

  // ── Step 5: Stitch 256×256 spritesheet ──────────────────────────────────────
  const buf = await stitchSpritesheet(rows);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

// ─── V1 walk spritesheet (kept for fallback) ──────────────────────────────────

/**
 * V1 pipeline: BitForge → Rotate ×3 → animate-with-text ×4 → stitch.
 * Used as fallback if V2 is unavailable.
 */
export async function generateWalkSpritesheet(
  description: string,
  apiKey: string,
  referenceB64?: string,
): Promise<string> {
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
      )
        .then((r) => r.json() as Promise<{ image: PlImage }>)
        .then((d) => d.image.base64),
    ),
  );

  const dirImages = [southB64, westB64, eastB64, northB64];
  const DIRS = ["south", "west", "east", "north"] as const;

  const animResults = await Promise.all(
    dirImages.map((imgB64, i) =>
      plPost(
        "/animate-with-text",
        {
          description,
          action: "walking, legs alternating, left and right foot stepping forward in turn, walk cycle",
          reference_image: { type: "base64", base64: imgB64 } as PlImage,
          image_size: { width: 64, height: 64 },
          n_frames: 4,
          view: "low top-down",
          direction: DIRS[i],
          image_guidance_scale: 1.5,
          negative_description: "background, grey background, solid background, scenery, environment",
        },
        apiKey,
      ).then((r) => r.json() as Promise<{ images: PlImage[] }>),
    ),
  );

  const rows = animResults.map((r) => r.images.map((img) => img.base64));
  const buf = await stitchSpritesheet(rows);
  return `data:image/png;base64,${buf.toString("base64")}`;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

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
