import { NextRequest, NextResponse } from "next/server";

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
    await new Promise((r) => setTimeout(r, 3000));
    const job = await v2Get(`/background-jobs/${jobId}`, apiKey) as { status: string; error?: string };
    console.log(`[create-character] job ${jobId} → ${job.status}`);
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
  const { description } = await req.json() as { description: string };
  const apiKey = process.env.PIXELLAB_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Missing PixelLab API key" }, { status: 500 });
  if (!description?.trim()) return NextResponse.json({ error: "Missing description" }, { status: 400 });

  try {
    // Step 1: Create character with 4 directions
    const createData = await v2Post("/create-character-with-4-directions", {
      description: description.trim(),
      image_size: { width: 64, height: 64 },
      view: "low top-down",
    }, apiKey) as { character_id: string; background_job_id: string };

    const { character_id, background_job_id } = createData;
    console.log(`[create-character] character_id=${character_id} job=${background_job_id}`);

    // Step 2: Poll until complete
    await pollJob(background_job_id, apiKey);

    // Step 3: Get rotation URLs
    const charData = await v2Get(`/characters/${character_id}`, apiKey) as {
      rotation_urls?: Record<string, string>;
    };
    const rotationUrls = charData.rotation_urls ?? {};
    console.log(`[create-character] rotation_urls keys: ${Object.keys(rotationUrls).join(", ")}`);

    // Step 4: Download images as data URIs
    const dirs = ["south", "west", "east", "north"] as const;
    const images: Record<string, string> = {};
    for (const dir of dirs) {
      const url = rotationUrls[dir];
      if (url) {
        images[dir] = `data:image/png;base64,${await urlToBase64(url)}`;
      }
    }

    return NextResponse.json({ character_id, ...images });
  } catch (err) {
    console.error("[create-character] Error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
