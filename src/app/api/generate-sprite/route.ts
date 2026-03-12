import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import {
  generateWalkSpritesheetV2,
  plPost,
  stitchSpritesheet,
  type PlImage,
} from "@/lib/pixellab";

export const maxDuration = 180;

// ── Your trained LoRA model ID ─────────────────────────────────────────────
const LORA_MODEL_VERSION =
  "rafaelmaitraavalos-lang/gba-sprite-lora-v2:774e9d0772bd51a601050c59659cca34998113ff7152567dabc40b3bade4f66c";
// ^ paste your full version string from Replicate (the long hash from the JS snippet)

const ACCESSORY_LAYERS = new Set(["hat", "cape", "weapon", "accessory", "shield"]);

// ── Pixelation post-process ────────────────────────────────────────────────
// Shrinks to 25% then back up with nearest-neighbor = hard pixel grid
async function pixelate(base64: string): Promise<string> {
  const buf = Buffer.from(base64, "base64");
  const img = sharp(buf);
  const meta = await img.metadata();
  const w = meta.width ?? 576;
  const h = meta.height ?? 256;

  // Step 1: shrink to 25% (nearest-neighbor = no smoothing)
  const small = await sharp(buf)
    .resize(Math.round(w * 0.25), Math.round(h * 0.25), { kernel: "nearest" })
    .toBuffer();

  // Step 2: scale back up to original size (nearest-neighbor = hard pixels)
  const pixelated = await sharp(small)
    .resize(w, h, { kernel: "nearest" })
    .png()
    .toBuffer();

  return pixelated.toString("base64");
}

export async function POST(req: NextRequest) {
  const { prompt, type, layerType } = await req.json();
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const pixellabKey = process.env.PIXELLAB_API_KEY;

  if (!replicateToken) {
    return NextResponse.json({ error: "Missing Replicate token" }, { status: 500 });
  }

  const isAccessory = ACCESSORY_LAYERS.has(layerType ?? "");

  // ── Step 1: Claude prompt enhancement ─────────────────────────────────────
  let improvedPrompt = prompt as string;

  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const claudeResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: `You are a GBA pixel art RPG character designer. Given a character or accessory description, return an enhanced prompt for a pixel art sprite generator. The sprite should fit a GBA RPG style like Zelda, Fire Emblem, or Pokemon. Include specific colors, materials, and visual details. Keep all equipment grounded and physical — no magical effects, no glow, no luminous aura, no light emanation, no particle effects, no sword trails, no energy beams. Weapons are plain metal or wood. GBA-style proportions: large head relative to body, short legs, chibi-like, compact and cute. Similar to Link in A Link to the Past or GBA RPG sprites. The character should occupy the lower 75% of the 64x64 frame with visible head padding at top. Return only the enhanced prompt, no other text.`,
        messages: [{ role: "user", content: `Convert this into a pixel art generation prompt: "${prompt}"` }],
      });
      if (claudeResponse.content[0].type === "text") {
        improvedPrompt = claudeResponse.content[0].text;
      }
    } catch (err) {
      console.warn("[generate-sprite] Claude enhancement failed:", (err as Error).message);
    }
  }

  if (type === "character") {
    improvedPrompt = `${improvedPrompt}, fully clothed, wearing outfit, dressed`;
  }

  // ── Step 2: LoRA (primary for humanoid characters) ────────────────────────
  if (!isAccessory) {
    try {
      const loraPrompt = `gba_sprite, ${improvedPrompt}, walking animation, 4 directions, top-down rpg`;

      const response = await fetch("https://api.replicate.com/v1/predictions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
          Prefer: "wait",
        },
        body: JSON.stringify({
          version: LORA_MODEL_VERSION,
          input: {
            prompt: loraPrompt,
            aspect_ratio: "custom",
            width: 576,
            height: 256,
            num_inference_steps: 28,
            guidance_scale: 3.5,
            model: "dev",
          },
        }),
      });

      if (response.ok) {
        const prediction = await response.json();
        const imageUrl = prediction.output?.[0];

        if (imageUrl) {
          const imageRes = await fetch(imageUrl);
          const rawBase64 = Buffer.from(await imageRes.arrayBuffer()).toString("base64");

          // Pixelate the output
          const pixelatedBase64 = await pixelate(rawBase64);

          return NextResponse.json({
            image: `data:image/png;base64,${pixelatedBase64}`,
            originalPrompt: prompt,
            improvedPrompt,
            source: "lora",
          });
        }
      }
    } catch (err) {
      console.warn("[generate-sprite] LoRA failed, falling back to PixelLab:", (err as Error).message);
    }
  }

  // ── Step 3: PixelLab fallback ──────────────────────────────────────────────
  if (pixellabKey) {
    try {
      let spritesheetDataUri: string;

      if (isAccessory) {
        const res = await plPost(
          "/generate-image-bitforge",
          {
            description: improvedPrompt,
            image_size: { width: 64, height: 64 },
            no_background: true,
            view: "low top-down",
            outline: "single color black outline",
            shading: "detailed shading",
            detail: "highly detailed",
          },
          pixellabKey,
        );
        const data = (await res.json()) as { image: PlImage };
        const b64 = data.image.base64;
        const rows = Array.from({ length: 4 }, () => Array(4).fill(b64) as string[]);
        const buf = await stitchSpritesheet(rows);
        spritesheetDataUri = `data:image/png;base64,${buf.toString("base64")}`;
      } else {
        spritesheetDataUri = await generateWalkSpritesheetV2(improvedPrompt, pixellabKey);
      }

      return NextResponse.json({
        image: spritesheetDataUri,
        originalPrompt: prompt,
        improvedPrompt,
        source: "pixellab",
      });
    } catch (err) {
      console.warn("[generate-sprite] PixelLab failed:", (err as Error).message);
    }
  }

  // ── Step 4: Replicate retro-diffusion last resort ──────────────────────────
  const replicateInput: Record<string, unknown> = {
    prompt: improvedPrompt,
    style: "four_angle_walking",
    width: 64,
    height: 64,
    return_spritesheet: true,
  };

  const fallbackResponse = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version: "retro-diffusion/rd-animation", input: replicateInput }),
  });

  if (!fallbackResponse.ok) {
    const errorText = await fallbackResponse.text();
    return NextResponse.json({ error: `Replicate error: ${fallbackResponse.status} - ${errorText}` }, { status: 500 });
  }

  const prediction = await fallbackResponse.json();
  const imageUrl = prediction.output?.[0];
  if (!imageUrl) return NextResponse.json({ error: "No image generated" }, { status: 500 });

  const imageRes = await fetch(imageUrl);
  const base64 = Buffer.from(await imageRes.arrayBuffer()).toString("base64");
  return NextResponse.json({ image: `data:image/png;base64,${base64}`, originalPrompt: prompt, improvedPrompt, source: "retro-diffusion" });
}
