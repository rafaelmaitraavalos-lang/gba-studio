import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_SYSTEM = `You are a GBA pixel art RPG character designer. Given a character name and a list of equipped items (slot → item name), write an enhanced prompt for a pixel art walk cycle spritesheet generator. The character should look like a GBA RPG protagonist (Zelda, Fire Emblem, Final Fantasy Tactics Advance style), clearly wearing and holding the described equipment. Include specific visual details about colors, materials, and silhouette for each item. Return only the enhanced prompt, no other text.`;

async function uploadImageToReplicate(base64DataUri: string, token: string): Promise<string> {
  const base64 = base64DataUri.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");
  const res = await fetch("https://api.replicate.com/v1/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/png",
      "Content-Disposition": 'attachment; filename="character.png"',
    },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Replicate file upload failed: ${res.status} ${await res.text()}`);
  const file = await res.json() as { urls: { get: string } };
  return file.urls.get;
}

export async function POST(req: NextRequest) {
  const { characterName, equippedItems, characterSpritesheet } = (await req.json()) as {
    characterName: string;
    equippedItems: { slot: string; name: string }[];
    characterSpritesheet?: string | null;
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

  // ── Step 2: Upload character image for img2img conditioning ──
  let imageUrl: string | undefined;
  if (characterSpritesheet) {
    try {
      imageUrl = await uploadImageToReplicate(characterSpritesheet, replicateToken);
      console.log("[generate-equipped] Uploaded reference image:", imageUrl);
    } catch (err) {
      console.warn("[generate-equipped] Image upload failed, falling back to text-only:", (err as Error).message);
    }
  }

  // ── Step 3: rd-animation four_angle_walking ──
  const modelInput: Record<string, unknown> = {
    prompt: enhancedPrompt,
    style: "four_angle_walking",
    width: 64,
    height: 64,
    return_spritesheet: true,
    negative_prompt: "naked, nude, bare skin, undressed",
  };
  if (imageUrl) {
    modelInput.image_url     = imageUrl;
    modelInput.noise_strength = 0.15;
  }

  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${replicateToken}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      version: "retro-diffusion/rd-animation",
      input: modelInput,
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
  return NextResponse.json({
    image: `data:image/png;base64,${Buffer.from(buf).toString("base64")}`,
  });
}
