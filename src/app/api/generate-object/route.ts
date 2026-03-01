import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { plPost, type PlImage } from "@/lib/pixellab";

const PLACEMENT_HINTS: Record<string, string> = {
  floor:
    "top-down view, seen directly from above, object lies flat on the ground, overhead perspective",
  north_wall:
    "viewed from the front at a slightly elevated angle, object is against the back wall, front-facing with slight downward perspective",
  south_wall:
    "viewed from behind at a slightly elevated angle, object is against the front wall, rear-facing with slight downward perspective",
  side_wall:
    "side view with slight elevation, object is mounted against a side wall, lateral perspective",
};

const CLAUDE_SYSTEM = `You are a top-down GBA pixel art object designer. Given an object description and a placement hint, return an enhanced prompt for a pixel art generator. The object should be self-contained with no background, clean pixel art style matching Zelda: A Link to the Past. Incorporate the placement perspective naturally into the description. Return only the enhanced prompt, no other text.`;

export async function POST(req: NextRequest) {
  const { name, description, placement } = (await req.json()) as {
    name: string;
    description: string;
    placement: string;
  };

  const anthropicKey   = process.env.ANTHROPIC_API_KEY;
  const replicateToken = process.env.REPLICATE_API_TOKEN;
  const pixellabKey    = process.env.PIXELLAB_API_KEY;

  if (!anthropicKey)    return NextResponse.json({ error: "Missing Anthropic API key" }, { status: 500 });
  if (!replicateToken)  return NextResponse.json({ error: "Missing Replicate API token" }, { status: 500 });

  const placementHint = PLACEMENT_HINTS[placement] ?? PLACEMENT_HINTS.floor;

  // ── Step 1: Claude enhances the prompt ─────────────────────────────────────
  let enhancedPrompt = `${description}, ${placementHint}`;
  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 300,
      system: CLAUDE_SYSTEM,
      messages: [{ role: "user", content: `Object name: "${name}"\nDescription: ${description}\nPlacement: ${placementHint}` }],
    });
    if (msg.content[0].type === "text") enhancedPrompt = msg.content[0].text.trim();
  } catch (err) {
    console.warn("[generate-object] Claude enhancement failed:", (err as Error).message);
  }

  // ── Step 2: PixelLab (primary) ─────────────────────────────────────────────
  if (pixellabKey) {
    try {
      const res = await plPost(
        "/generate-image-bitforge",
        {
          description: enhancedPrompt,
          image_size: { width: 64, height: 64 },
          no_background: true,
          view: "high top-down",
          outline: "single color black outline",
          shading: "detailed shading",
          detail: "highly detailed",
        },
        pixellabKey,
      );
      const data = (await res.json()) as { image: PlImage };
      const imageBase64 = `data:image/png;base64,${data.image.base64}`;
      return NextResponse.json({ image: imageBase64, enhancedPrompt });
    } catch (err) {
      console.warn("[generate-object] PixelLab failed, falling back to Replicate:", (err as Error).message);
    }
  }

  // ── Step 3: Replicate fallback (rd-plus topdown_asset with polling) ─────────
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

    if (!submitRes.ok) throw new Error(`Replicate submit failed: ${submitRes.status} ${await submitRes.text()}`);
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
    console.error("[generate-object] Replicate error:", (err as Error).message);
  }

  return NextResponse.json({ image: imageBase64, enhancedPrompt });
}
