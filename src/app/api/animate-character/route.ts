import { NextRequest, NextResponse } from "next/server";
import { stitchSpritesheet } from "@/lib/pixellab";

export const maxDuration = 180;

const PL_V2 = "https://api.pixellab.ai/v2";

async function v2Post(path: string, body: object, apiKey: string) {
  const res = await fetch(`${PL_V2}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PixelLab v2 POST ${path} error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function v2Get(path: string, apiKey: string) {
  const res = await fetch(`${PL_V2}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`PixelLab v2 GET ${path} error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function pollJob(jobId: string, apiKey: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 170_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const job = await v2Get(`/background-jobs/${jobId}`, apiKey) as {
      status: string;
      error?: string;
      last_response?: { storage_urls?: { frames?: string[] } };
    };
    console.log(`[animate-character] job ${jobId} → ${job.status}`);
    if (job.status === "completed") return job as Record<string, unknown>;
    if (job.status === "failed") throw new Error(`Job ${jobId} failed: ${job.error ?? "unknown"}`);
  }
  throw new Error("Job timed out after 3 minutes");
}

async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

export async function POST(req: NextRequest) {
  const { character_id } = await req.json() as { character_id: string };
  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing PixelLab API key" }, { status: 500 });
  if (!character_id) return NextResponse.json({ error: "Missing character_id" }, { status: 400 });

  try {
    // Step 1: Request walk animation
    const animData = await v2Post("/animate-character", {
      character_id,
      template_animation_id: "walking-8-frames",
    }, apiKey) as { background_job_ids: string[]; directions: string[] };

    const { background_job_ids, directions } = animData;
    console.log(`[animate-character] jobs=${JSON.stringify(background_job_ids)} dirs=${JSON.stringify(directions)}`);

    // Step 2: Poll all jobs in parallel
    const jobResults = await Promise.allSettled(
      background_job_ids.map((id) => pollJob(id, apiKey)),
    );

    // Step 3: Extract walk frames per direction
    const walkFrames: Record<string, string[]> = {};
    for (let i = 0; i < directions.length; i++) {
      const dir = directions[i];
      const result = jobResults[i];
      if (result.status === "fulfilled") {
        const job = result.value as { last_response?: { storage_urls?: { frames?: string[] } } };
        const frameUrls = job.last_response?.storage_urls?.frames ?? [];
        if (frameUrls.length > 0) {
          try {
            walkFrames[dir] = await Promise.all(frameUrls.slice(0, 8).map(urlToBase64));
            console.log(`[animate-character] ${dir}: ${walkFrames[dir].length} walk frames`);
          } catch (err) {
            console.warn(`[animate-character] failed to fetch frames for ${dir}:`, (err as Error).message);
          }
        }
      } else {
        console.warn(`[animate-character] job for ${dir} failed:`, result.reason);
      }
    }

    // Step 4: Static fallback from character rotation_urls
    const charData = await v2Get(`/characters/${character_id}`, apiKey) as {
      rotation_urls?: Record<string, string>;
    };
    const rotationUrls = charData.rotation_urls ?? {};

    // Step 5: Build rows [south, west, east, north]
    const DIR_ORDER = ["south", "west", "east", "north"] as const;
    const rows: string[][] = [];
    for (const dir of DIR_ORDER) {
      if (walkFrames[dir]?.length > 0) {
        rows.push(walkFrames[dir]);
      } else {
        const url = rotationUrls[dir];
        if (url) {
          try {
            const b64 = await urlToBase64(url);
            console.log(`[animate-character] ${dir}: using static fallback ×8`);
            rows.push([b64, b64, b64, b64, b64, b64, b64, b64]);
          } catch {
            rows.push([]);
          }
        } else {
          rows.push([]);
        }
      }
    }

    if (rows.every((r) => r.length === 0)) {
      throw new Error("No frames found for any direction");
    }

    // Step 6: Stitch spritesheet
    const buf = await stitchSpritesheet(rows);
    const spritesheetUrl = `data:image/png;base64,${buf.toString("base64")}`;

    return NextResponse.json({ spritesheetUrl });
  } catch (err) {
    console.error("[animate-character] Error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
