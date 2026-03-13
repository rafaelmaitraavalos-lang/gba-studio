import { NextRequest, NextResponse } from "next/server";
import { stitchSpritesheet } from "@/lib/pixellab";

export const maxDuration = 60;

const PL_V2 = "https://api.pixellab.ai/v2";

async function urlToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  return Buffer.from(await res.arrayBuffer()).toString("base64");
}

type DirFrames = Record<string, string[]>; // direction → array of frame URLs

/**
 * Try to extract walking-8-frames URLs from the character response.
 * PixelLab V2 may return animations in several shapes — we check all known paths.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractWalkFrames(data: Record<string, any>): DirFrames | null {
  // Shape A: data.animations = [ { template_animation_id, storage_urls: { south: [...], ... } } ]
  if (Array.isArray(data.animations)) {
    const walkAnim = data.animations.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (a: any) =>
        typeof a.template_animation_id === "string" &&
        a.template_animation_id.includes("walking"),
    );
    if (walkAnim?.storage_urls && typeof walkAnim.storage_urls === "object") {
      const urls = walkAnim.storage_urls as Record<string, unknown>;
      if (Object.values(urls).some((v) => Array.isArray(v) && (v as string[]).length > 0)) {
        return Object.fromEntries(
          Object.entries(urls).map(([k, v]) => [k, Array.isArray(v) ? (v as string[]) : []]),
        );
      }
    }
  }

  // Shape B: data.animations = { "walking-8-frames": { south: [...], ... } }
  if (data.animations && typeof data.animations === "object" && !Array.isArray(data.animations)) {
    const animMap = data.animations as Record<string, unknown>;
    for (const key of Object.keys(animMap)) {
      if (key.includes("walking")) {
        const dirs = animMap[key] as Record<string, unknown>;
        if (dirs && typeof dirs === "object") {
          const result: DirFrames = {};
          for (const [dir, frames] of Object.entries(dirs)) {
            result[dir] = Array.isArray(frames) ? (frames as string[]) : [];
          }
          if (Object.values(result).some((f) => f.length > 0)) return result;
        }
      }
    }
  }

  // Shape C: data.walk_animation_urls or data.walking_frames
  for (const key of ["walk_animation_urls", "walking_frames", "walk_frames"]) {
    const val = data[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const result: DirFrames = {};
      for (const [dir, frames] of Object.entries(val as Record<string, unknown>)) {
        result[dir] = Array.isArray(frames) ? (frames as string[]) : [];
      }
      if (Object.values(result).some((f) => f.length > 0)) return result;
    }
  }

  return null;
}

export async function GET(req: NextRequest) {
  const character_id = req.nextUrl.searchParams.get("character_id");
  const apiKey = process.env.PIXELLAB_API_KEY;

  if (!apiKey) return NextResponse.json({ error: "Missing PixelLab API key" }, { status: 500 });
  if (!character_id) return NextResponse.json({ error: "Missing character_id" }, { status: 400 });

  try {
    const res = await fetch(`${PL_V2}/characters/${character_id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`GET /characters/${character_id} error ${res.status}: ${await res.text()}`);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as Record<string, any>;
    console.log(`[check-character-animation] character ${character_id} keys: ${Object.keys(data).join(", ")}`);

    const walkFrames = extractWalkFrames(data);
    if (!walkFrames) {
      console.log(`[check-character-animation] no walk frames found yet`);
      return NextResponse.json({ complete: false });
    }

    const DIR_ORDER = ["south", "west", "east", "north"] as const;
    const rotationUrls = (data.rotation_urls ?? {}) as Record<string, string>;
    const rows: string[][] = [];

    for (const dir of DIR_ORDER) {
      const frameUrls = walkFrames[dir] ?? [];
      if (frameUrls.length > 0) {
        const frames = await Promise.all(frameUrls.slice(0, 8).map(urlToBase64));
        console.log(`[check-character-animation] ${dir}: ${frames.length} walk frames`);
        rows.push(frames);
      } else {
        // Static fallback from rotation_urls
        const rotUrl = rotationUrls[dir];
        if (rotUrl) {
          const b64 = await urlToBase64(rotUrl);
          rows.push([b64, b64, b64, b64, b64, b64, b64, b64]);
        } else {
          rows.push([]);
        }
      }
    }

    if (rows.every((r) => r.length === 0)) {
      return NextResponse.json({ complete: false });
    }

    const buf = await stitchSpritesheet(rows);
    const spritesheetUrl = `data:image/png;base64,${buf.toString("base64")}`;

    return NextResponse.json({ complete: true, spritesheetUrl });
  } catch (err) {
    console.error("[check-character-animation] Error:", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
