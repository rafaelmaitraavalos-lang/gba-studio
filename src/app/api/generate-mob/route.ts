import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_SYSTEM = `You are a GBA pixel art enemy designer. Given a mob/enemy description, return an enhanced prompt for a pixel art sprite generator. The mob should look threatening but fit a GBA RPG style like Zelda or Pokemon. It should be a walking/moving creature viewed from slightly above. Include specific colors, features, and style details. Return only the enhanced prompt, no other text.`;

export async function POST(req: NextRequest) {
  const { name, description } = (await req.json()) as { name: string; description: string };

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!replicateToken) {
    return NextResponse.json({ error: "Missing Replicate token" }, { status: 500 });
  }

  // ── Step 1: Claude enhances the prompt ──
  let improvedPrompt = description;

  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 300,
        system: CLAUDE_SYSTEM,
        messages: [{
          role: "user",
          content: `Enemy name: "${name}"\nDescription: ${description}`,
        }],
      });
      if (msg.content[0].type === "text") {
        improvedPrompt = msg.content[0].text.trim();
      }
    } catch (err) {
      console.warn("[generate-mob] Claude enhancement failed:", (err as Error).message);
    }
  }

  // ── Step 2: rd-animation four_angle_walking ──
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      version: "retro-diffusion/rd-animation",
      input: {
        prompt: improvedPrompt,
        style: "four_angle_walking",
        width: 64,
        height: 64,
        return_spritesheet: true,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: `Replicate error: ${response.status} - ${errorText}` },
      { status: 500 }
    );
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
    spritesheet: `data:image/png;base64,${base64}`,
    improvedPrompt,
  });
}
