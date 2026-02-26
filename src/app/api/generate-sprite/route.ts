import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

/* Layer types that go through the accessory pipeline (item-only, no body) */
const ACCESSORY_LAYERS = new Set(["hat", "cape", "weapon", "accessory", "shield"]);

/* Layer types that go through the humanoid pipeline (full body with walk cycle) */
const HUMANOID_LAYERS = new Set(["base", "clothing"]);

export async function POST(req: NextRequest) {
  const { prompt, type, layerType } = await req.json();
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!replicateToken) {
    return NextResponse.json({ error: "Missing Replicate token" }, { status: 500 });
  }

  const isAccessory = ACCESSORY_LAYERS.has(layerType ?? "");

  // ── Step 1: Claude prompt enhancement ──
  let improvedPrompt = prompt;

  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });

      const systemPrompt = `You are a GBA pixel art enemy designer. Given a mob/enemy description, return an enhanced prompt for a pixel art sprite generator. The mob should look threatening but fit a GBA RPG style like Zelda or Pokemon. It should be a walking/moving creature viewed from slightly above. Include specific colors, features, and style details. Return only the enhanced prompt, no other text.`;

      const claudeResponse = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{
          role: "user",
          content: `Convert this into a pixel art generation prompt: "${prompt}"`,
        }],
      });

      if (claudeResponse.content[0].type === "text") {
        improvedPrompt = claudeResponse.content[0].text;
      }
    } catch (err) {
      console.warn("Claude prompt enhancement failed, using fallback:", (err as Error).message);
    }
  }

  // ── Step 2: Generate with Replicate ──
  // Both pipelines use rd-animation with four_angle_walking to get a proper 4x4 spritesheet

  // Enforce clothing on every character prompt sent to Replicate
  if (type === "character") {
    improvedPrompt = `${improvedPrompt}, fully clothed, wearing outfit, dressed`;
  }

  const NUDITY_NEGATIVE = "naked, nude, bare skin, undressed, topless, shirtless";

  const replicateInput: Record<string, unknown> = {
    prompt: improvedPrompt,
    style: "four_angle_walking",
    width: 64,
    height: 64,
    return_spritesheet: true,
  };

  if (isAccessory) {
    replicateInput.negative_prompt =
      `character, person, humanoid, body, legs, arms, head, face, torso, hands, feet, walking figure, standing figure, scene, background, ${NUDITY_NEGATIVE}`;
  } else if (type === "character") {
    replicateInput.negative_prompt = NUDITY_NEGATIVE;
  }

  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      "Prefer": "wait",
    },
    body: JSON.stringify({
      version: "retro-diffusion/rd-animation",
      input: replicateInput,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json({ error: `Replicate error: ${response.status} - ${errorText}` }, { status: 500 });
  }

  const prediction = await response.json();
  const imageUrl = prediction.output?.[0];

  if (!imageUrl) {
    return NextResponse.json({ error: "No image generated" }, { status: 500 });
  }

  const imageRes = await fetch(imageUrl);
  const buffer = await imageRes.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");

  return NextResponse.json({
    image: `data:image/png;base64,${base64}`,
    originalPrompt: prompt,
    improvedPrompt: improvedPrompt,
  });
}
