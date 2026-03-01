import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import {
  generateWalkSpritesheetV2,
  plPost,
  stitchSpritesheet,
  type PlImage,
} from "@/lib/pixellab";

export const maxDuration = 180;

/* Layer types that go through the accessory pipeline (item-only, no body) */
const ACCESSORY_LAYERS = new Set(["hat", "cape", "weapon", "accessory", "shield"]);

export async function POST(req: NextRequest) {
  const { prompt, type, layerType } = await req.json();
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;
  const pixellabKey    = process.env.PIXELLAB_API_KEY;

  if (!replicateToken) {
    return NextResponse.json({ error: "Missing Replicate token" }, { status: 500 });
  }

  const isAccessory = ACCESSORY_LAYERS.has(layerType ?? "");

  // ── Step 1: Claude prompt enhancement ──────────────────────────────────────
  let improvedPrompt = prompt as string;

  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const claudeResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: `You are a GBA pixel art RPG character designer. Given a character or accessory description, return an enhanced prompt for a pixel art sprite generator. The sprite should fit a GBA RPG style like Zelda, Fire Emblem, or Pokemon. Include specific colors, features, and style details. Return only the enhanced prompt, no other text.`,
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

  // ── Step 2: PixelLab (primary) ─────────────────────────────────────────────
  if (pixellabKey) {
    try {
      let spritesheetDataUri: string;

      if (isAccessory) {
        // Accessories: generate a single clean item image, then tile into spritesheet
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
        // Tile the single image across all 16 frames
        const rows = Array.from({ length: 4 }, () => Array(4).fill(b64) as string[]);
        const buf = await stitchSpritesheet(rows);
        spritesheetDataUri = `data:image/png;base64,${buf.toString("base64")}`;
      } else {
        // Humanoid: full 4-direction walk cycle
        spritesheetDataUri = await generateWalkSpritesheetV2(improvedPrompt, pixellabKey);
      }

      return NextResponse.json({
        image: spritesheetDataUri,
        originalPrompt: prompt,
        improvedPrompt,
      });
    } catch (err) {
      console.warn("[generate-sprite] PixelLab failed, falling back to Replicate:", (err as Error).message);
    }
  }

  // ── Step 3: Replicate fallback ─────────────────────────────────────────────
  const NUDITY_NEGATIVE = "naked, nude, bare skin, undressed, topless, shirtless";

  const replicateInput: Record<string, unknown> = {
    prompt: improvedPrompt,
    style: "four_angle_walking",
    width: 64,
    height: 64,
    return_spritesheet: true,
  };

  if (isAccessory) {
    replicateInput.negative_prompt = `character, person, humanoid, body, legs, arms, head, face, torso, hands, feet, walking figure, standing figure, scene, background, ${NUDITY_NEGATIVE}`;
  } else if (type === "character") {
    replicateInput.negative_prompt = NUDITY_NEGATIVE;
  }

  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({ version: "retro-diffusion/rd-animation", input: replicateInput }),
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
  return NextResponse.json({ image: `data:image/png;base64,${base64}`, originalPrompt: prompt, improvedPrompt });
}
