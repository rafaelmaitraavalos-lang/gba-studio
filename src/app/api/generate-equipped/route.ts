import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { generateWalkSpritesheet, stripDataUri, extractFirstFrame } from "@/lib/pixellab";

const CLAUDE_SYSTEM = `You are a GBA pixel art RPG character designer. Given a character name and a list of equipped items (slot → item name), write an enhanced prompt for a pixel art walk cycle spritesheet generator. The character should look like a GBA RPG protagonist (Zelda, Fire Emblem, Final Fantasy Tactics Advance style), clearly wearing and holding the described equipment. Include specific visual details about colors, materials, and silhouette for each item. Return only the enhanced prompt, no other text.`;

export async function POST(req: NextRequest) {
  const { characterName, equippedItems, characterSpritesheet } = (await req.json()) as {
    characterName: string;
    equippedItems: { slot: string; name: string }[];
    characterSpritesheet?: string | null;
  };

  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const anthropicKey   = process.env.ANTHROPIC_API_KEY;
  const pixellabKey    = process.env.PIXELLAB_API_KEY;

  if (!replicateToken) return NextResponse.json({ error: "Missing Replicate token" }, { status: 500 });

  // ── Step 1: Claude builds enhanced prompt ──────────────────────────────────
  const itemList = equippedItems.map((i) => `${i.slot}: ${i.name}`).join(", ");
  let enhancedPrompt = `${characterName} character wearing ${itemList}, GBA RPG pixel art, 4-direction walk cycle`;

  if (anthropicKey) {
    try {
      const anthropic = new Anthropic({ apiKey: anthropicKey });
      const msg = await anthropic.messages.create({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 350,
        system: CLAUDE_SYSTEM,
        messages: [{ role: "user", content: `Character name: "${characterName}"\nEquipped items: ${itemList}` }],
      });
      if (msg.content[0].type === "text") enhancedPrompt = msg.content[0].text.trim();
    } catch (err) {
      console.warn("[generate-equipped] Claude failed:", (err as Error).message);
    }
  }

  enhancedPrompt = `${enhancedPrompt}, fully clothed, wearing outfit, dressed`;

  // ── Step 2: PixelLab (primary) ─────────────────────────────────────────────
  if (pixellabKey) {
    try {
      // Extract the first frame of the character spritesheet as the reference image
      let referenceB64: string | undefined;
      if (characterSpritesheet) {
        const raw = stripDataUri(characterSpritesheet);
        referenceB64 = await extractFirstFrame(Buffer.from(raw, "base64"));
      }

      const spritesheet = await generateWalkSpritesheet(enhancedPrompt, pixellabKey, referenceB64);
      return NextResponse.json({ image: spritesheet });
    } catch (err) {
      console.warn("[generate-equipped] PixelLab failed, falling back to Replicate:", (err as Error).message);
    }
  }

  // ── Step 3: Replicate fallback (text-only rd-animation) ────────────────────
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
  const outputUrl = prediction.output?.[0] as string | undefined;
  if (!outputUrl) return NextResponse.json({ error: "No image generated" }, { status: 500 });

  const buf = await (await fetch(outputUrl)).arrayBuffer();
  return NextResponse.json({ image: `data:image/png;base64,${Buffer.from(buf).toString("base64")}` });
}
