import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_SYSTEM = `You are a GBA pixel art RPG character designer. Given a character name and a list of equipped items (slot → item name), write an enhanced prompt for a pixel art walk cycle spritesheet generator. The character should look like a GBA RPG protagonist (Zelda, Fire Emblem, Final Fantasy Tactics Advance style), clearly wearing and holding the described equipment. Include specific visual details about colors, materials, and silhouette for each item. Return only the enhanced prompt, no other text.`;

export async function POST(req: NextRequest) {
  const { characterName, equippedItems } = (await req.json()) as {
    characterName: string;
    equippedItems: { slot: string; name: string }[];
  };

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;

  if (!replicateToken) return NextResponse.json({ error: "Missing Replicate token" }, { status: 500 });

  // ── Step 1: Claude builds the combined prompt ──
  const itemList = equippedItems.map((i) => `${i.slot}: ${i.name}`).join(", ");
  let enhancedPrompt = `${characterName} character wearing ${itemList}, GBA RPG pixel art, 4-direction walk cycle`;

  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 350,
        system: CLAUDE_SYSTEM,
        messages: [{
          role: "user",
          content: `Character name: "${characterName}"\nEquipped items: ${itemList}`,
        }],
      });
      if (msg.content[0].type === "text") enhancedPrompt = msg.content[0].text.trim();
    } catch (err) {
      console.warn("[generate-equipped] Claude failed:", (err as Error).message);
    }
  }

  // Enforce clothing / no nudity
  enhancedPrompt = `${enhancedPrompt}, fully clothed, wearing outfit, dressed`;

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
        prompt: enhancedPrompt,
        style: "four_angle_walking",
        width: 64,
        height: 64,
        return_spritesheet: true,
        negative_prompt: "naked, nude, bare skin, undressed",
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    return NextResponse.json({ error: `Replicate error: ${response.status} – ${text}` }, { status: 500 });
  }

  const prediction = await response.json();
  const imageUrl = prediction.output?.[0];
  if (!imageUrl) return NextResponse.json({ error: "No image generated" }, { status: 500 });

  const buf = await (await fetch(imageUrl)).arrayBuffer();
  return NextResponse.json({
    image: `data:image/png;base64,${Buffer.from(buf).toString("base64")}`,
  });
}
