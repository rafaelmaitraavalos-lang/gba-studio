import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { generateWalkSpritesheetV2, plPost, stitchSpritesheet, type PlImage } from "@/lib/pixellab";

export const maxDuration = 180;

const CLAUDE_SYSTEM = `You are enhancing descriptions for pixel art enemy sprites. Preserve the creature's natural form — blobs stay blobby, slimes stay round, insects stay insect-shaped. Only use a bipedal humanoid body if the creature is explicitly humanoid (e.g. skeleton, goblin, orc, zombie, demon, knight, bandit, witch). For non-humanoid creatures, do not add arms, legs, or upright stance. GBA pixel art style, top-down low angle view. Include specific colors, features, and visual details.

Return JSON only, no markdown:
{"prompt":"enhanced description here","humanoid":true}

humanoid=true for: skeleton, goblin, orc, zombie, demon, knight, bandit, witch, any creature with a human-like bipedal body.
humanoid=false for: slime, blob, insect, spider, dragon, snake, fish, bat, plant, elemental, any non-bipedal creature.`;

/**
 * Shift a 64×64 RGBA PNG down by 1px for a simple bob effect.
 * Adds 1px transparent row at top, crops bottom 1px.
 */
async function shiftDown1px(b64: string): Promise<string> {
  const buf = Buffer.from(b64, "base64");
  const shifted = await sharp(buf)
    .extend({ top: 1, bottom: 0, left: 0, right: 0, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extract({ left: 0, top: 0, width: 64, height: 64 })
    .png()
    .toBuffer();
  return shifted.toString("base64");
}

/**
 * Expand a 4-col × 4-row Replicate spritesheet (256×256) to 8-col × 4-row (512×256)
 * by looping the 4 frames twice per row.
 */
async function expandReplicateTo8Frames(b64: string): Promise<string> {
  const buf = Buffer.from(b64, "base64");
  const rows: string[][] = [];
  for (let r = 0; r < 4; r++) {
    const frames: string[] = [];
    for (let f = 0; f < 4; f++) {
      const frameBuf = await sharp(buf)
        .extract({ left: f * 64, top: r * 64, width: 64, height: 64 })
        .png()
        .toBuffer();
      frames.push(frameBuf.toString("base64"));
    }
    rows.push([...frames, ...frames]); // 4 frames looped twice → 8 cols
  }
  const stitched = await stitchSpritesheet(rows);
  return `data:image/png;base64,${stitched.toString("base64")}`;
}

export async function POST(req: NextRequest) {
  const { name, description } = (await req.json()) as { name: string; description: string };

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;
  const pixellabKey    = process.env.PIXELLAB_API_KEY;

  if (!replicateToken) {
    return NextResponse.json({ error: "Missing Replicate token" }, { status: 500 });
  }

  // ── Step 1: Claude enhances the prompt + detects humanoid ──────────────────
  let improvedPrompt = description;
  let isHumanoid = true; // default so existing pipeline fires on parse failure

  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 400,
        system: CLAUDE_SYSTEM,
        messages: [{ role: "user", content: `Enemy name: "${name}"\nDescription: ${description}` }],
      });
      if (msg.content[0].type === "text") {
        const raw = msg.content[0].text.trim().replace(/```json\n?|\n?```/g, "");
        try {
          const parsed = JSON.parse(raw) as { prompt: string; humanoid: boolean };
          improvedPrompt = parsed.prompt ?? description;
          isHumanoid = parsed.humanoid ?? true;
        } catch {
          // Claude returned plain text instead of JSON — use as prompt, keep humanoid=true
          improvedPrompt = raw;
        }
      }
    } catch (err) {
      console.warn("[generate-mob] Claude enhancement failed:", (err as Error).message);
    }
  }

  console.log(`[generate-mob] name="${name}" humanoid=${isHumanoid}`);

  // ── Step 2: PixelLab (primary) ─────────────────────────────────────────────
  if (pixellabKey) {
    try {
      let spritesheet: string;

      if (isHumanoid) {
        // Animated 4-direction walk cycle via V2 pipeline — walking-8-frames → 512×256
        console.log("[generate-mob] pipeline: PixelLab V2 humanoid walk");
        spritesheet = await generateWalkSpritesheetV2(improvedPrompt, pixellabKey);
      } else {
        // Single Pixflux image + 1px bob → alternating 2-frame animation tiled 512×256
        console.log("[generate-mob] pipeline: PixelLab Pixflux static+bob");
        const res = await plPost(
          "/generate-image-pixflux",
          {
            description: improvedPrompt,
            image_size: { width: 64, height: 64 },
            view: "low top-down",
            no_background: true,
          },
          pixellabKey,
        );
        const data = (await res.json()) as { image: PlImage };
        const f0 = data.image.base64;
        const f1 = await shiftDown1px(f0);
        // 8 frames per row alternating f0/f1 — all 4 rows identical (no directional variation)
        const rows = Array.from({ length: 4 }, () => [f0, f1, f0, f1, f0, f1, f0, f1]);
        const buf = await stitchSpritesheet(rows);
        spritesheet = `data:image/png;base64,${buf.toString("base64")}`;
      }

      return NextResponse.json({ spritesheet, improvedPrompt, humanoid: isHumanoid });
    } catch (err) {
      console.warn("[generate-mob] PixelLab failed, falling back to Replicate:", (err as Error).message);
    }
  }

  // ── Step 3: Replicate fallback — four_angle_walking → expand to 512×256 ────
  console.log("[generate-mob] pipeline: Replicate fallback");
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      version: "retro-diffusion/rd-animation",
      input: { prompt: improvedPrompt, style: "four_angle_walking", width: 64, height: 64, return_spritesheet: true },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json({ error: `Replicate error: ${response.status} - ${errorText}` }, { status: 500 });
  }

  const prediction = await response.json();
  const imageUrl = prediction.output?.[0];
  if (!imageUrl) return NextResponse.json({ error: "No image generated" }, { status: 500 });

  const imageRes = await fetch(imageUrl);
  const base64 = Buffer.from(await imageRes.arrayBuffer()).toString("base64");
  // Replicate returns 4-frame 256×256 — expand to 512×256 to match PixelLab output
  const spritesheet = await expandReplicateTo8Frames(base64);
  return NextResponse.json({ spritesheet, improvedPrompt, humanoid: isHumanoid });
}
