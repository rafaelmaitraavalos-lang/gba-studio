import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

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

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const replicateToken = process.env.REPLICATE_API_TOKEN;

  console.log("[generate-object] ANTHROPIC_API_KEY defined:", !!anthropicKey);
  console.log("[generate-object] REPLICATE_API_TOKEN defined:", !!replicateToken);

  if (!anthropicKey) {
    return NextResponse.json({ error: "Missing Anthropic API key" }, { status: 500 });
  }
  if (!replicateToken) {
    return NextResponse.json({ error: "Missing Replicate API token" }, { status: 500 });
  }

  const placementHint = PLACEMENT_HINTS[placement] ?? PLACEMENT_HINTS.floor;

  // ── Step 1: Claude enhances the prompt ──
  let enhancedPrompt = `${description}, ${placementHint}`;
  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 300,
      system: CLAUDE_SYSTEM,
      messages: [{
        role: "user",
        content: `Object name: "${name}"\nDescription: ${description}\nPlacement: ${placementHint}`,
      }],
    });
    if (msg.content[0].type === "text") {
      enhancedPrompt = msg.content[0].text.trim();
    }
    console.log("[generate-object] enhanced prompt:", enhancedPrompt);
  } catch (err) {
    console.warn("[generate-object] Claude enhancement failed:", (err as Error).message);
  }

  // ── Step 2: rd-plus topdown_asset — submit then poll ──
  let imageBase64: string | null = null;
  try {
    const body = {
      input: {
        prompt: enhancedPrompt,
        style: "topdown_asset",
        width: 64,
        height: 64,
        num_images: 1,
        remove_bg: true,
      },
    };

    // Submit prediction
    const submitRes = await fetch(
      "https://api.replicate.com/v1/models/retro-diffusion/rd-plus/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const submitText = await submitRes.text();
    console.log("[generate-object] Submit HTTP status:", submitRes.status);

    if (!submitRes.ok) {
      throw new Error(`Replicate submit failed: ${submitRes.status} ${submitText}`);
    }

    const prediction = JSON.parse(submitText) as { id: string; status: string; output?: string[]; error?: string };
    const predictionId = prediction.id;
    console.log("[generate-object] Prediction ID:", predictionId);

    // Poll until succeeded or failed (max 60 s, every 2 s)
    const POLL_INTERVAL = 2000;
    const POLL_TIMEOUT = 60000;
    const deadline = Date.now() + POLL_TIMEOUT;
    let imageUrl: string | null = null;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL));

      const pollRes = await fetch(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        { headers: { Authorization: `Bearer ${replicateToken}` } }
      );
      const poll = JSON.parse(await pollRes.text()) as { status: string; output?: string[]; error?: string };
      console.log("[generate-object] Poll status:", poll.status);

      if (poll.status === "succeeded") {
        imageUrl = poll.output?.[0] ?? null;
        break;
      }
      if (poll.status === "failed") {
        console.error("[generate-object] Prediction failed:", poll.error);
        break;
      }
    }

    if (imageUrl) {
      const imageRes = await fetch(imageUrl);
      const buffer = await imageRes.arrayBuffer();
      imageBase64 = `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
      console.log("[generate-object] Image fetched, size:", buffer.byteLength);
    } else {
      console.error("[generate-object] No image URL after polling");
    }
  } catch (err) {
    console.error("[generate-object] Error:", (err as Error).message);
  }

  return NextResponse.json({ image: imageBase64, enhancedPrompt });
}
