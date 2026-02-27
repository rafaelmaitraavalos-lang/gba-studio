import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const SLOT_HINTS: Record<string, string> = {
  head:      "worn on the head — helmet, crown, hat, or headgear, viewed from slightly above",
  body:      "worn on the torso — armor, robe, or chest piece, front-facing at slight elevation",
  hand:      "held in the hand — weapon, shield, wand, or tool, single item clearly visible",
  feet:      "worn on the feet — boots, shoes, or sandals, viewed from a slightly elevated angle",
  accessory: "small wearable accessory — ring, amulet, necklace, belt, or cloak, fully visible icon",
};

const CLAUDE_SYSTEM = `You are a GBA pixel art RPG item icon designer. Given an item name, description, and equipment slot, write an enhanced prompt for a pixel art image generator. The item should be a single clean icon with no background, in the style of classic GBA RPGs like Fire Emblem or Final Fantasy Tactics Advance. Be specific about colors, materials, and visual details. Return only the enhanced prompt, no other text.`;

export async function POST(req: NextRequest) {
  const { name, description, slot } = (await req.json()) as {
    name: string;
    description: string;
    slot: string;
  };

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const replicateToken = process.env.REPLICATE_API_TOKEN;

  if (!anthropicKey)    return NextResponse.json({ error: "Missing Anthropic API key" }, { status: 500 });
  if (!replicateToken)  return NextResponse.json({ error: "Missing Replicate API token" }, { status: 500 });

  const slotHint = SLOT_HINTS[slot] ?? SLOT_HINTS.accessory;

  // ── Step 1: Claude enhances the prompt ──
  let enhancedPrompt = `${description}, ${slotHint}`;
  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 300,
      system: CLAUDE_SYSTEM,
      messages: [{
        role: "user",
        content: `Item name: "${name}"\nDescription: ${description}\nSlot: ${slotHint}`,
      }],
    });
    if (msg.content[0].type === "text") enhancedPrompt = msg.content[0].text.trim();
  } catch (err) {
    console.warn("[generate-item] Claude enhancement failed:", (err as Error).message);
  }

  // ── Step 2: rd-plus topdown_asset — submit then poll ──
  let imageBase64: string | null = null;
  try {
    const submitRes = await fetch(
      "https://api.replicate.com/v1/models/retro-diffusion/rd-plus/predictions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${replicateToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          input: { prompt: enhancedPrompt, style: "topdown_asset", width: 64, height: 64, num_images: 1, remove_bg: true },
        }),
      }
    );

    if (!submitRes.ok) throw new Error(`Replicate submit failed: ${submitRes.status}`);
    const prediction = (await submitRes.json()) as { id: string };

    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const poll = (await (await fetch(
        `https://api.replicate.com/v1/predictions/${prediction.id}`,
        { headers: { Authorization: `Bearer ${replicateToken}` } }
      )).json()) as { status: string; output?: string[]; error?: string };

      if (poll.status === "succeeded") {
        const url = poll.output?.[0];
        if (url) {
          const buf = await (await fetch(url)).arrayBuffer();
          imageBase64 = `data:image/png;base64,${Buffer.from(buf).toString("base64")}`;
        }
        break;
      }
      if (poll.status === "failed") break;
    }
  } catch (err) {
    console.error("[generate-item] Error:", (err as Error).message);
  }

  return NextResponse.json({ image: imageBase64 });
}
