import { NextRequest, NextResponse } from "next/server";

const ACCESSORY_DIMENSIONS: Record<string, { width: number; height: number }> = {
  cape:   { width: 24, height: 32 },
  hat:    { width: 24, height: 16 },
  shield: { width: 20, height: 24 },
  weapon: { width: 16, height: 32 },
  belt:   { width: 24, height: 12 },
  boots:  { width: 24, height: 16 },
  gloves: { width: 16, height: 16 },
};

const ACCESSORY_PROMPT_PREFIX: Record<string, string> = {
  cape:   "flowing cape, fabric only, no hood, no clasp, flat fabric only, isolated",
  hat:    "single hat, headwear only, isolated, top-down view",
  shield: "shield item, front-facing, isolated",
  weapon: "weapon item, isolated, vertical orientation",
  belt:   "belt item, horizontal, isolated",
  boots:  "pair of boots, isolated, top-down",
  gloves: "pair of gloves, isolated",
};

const DIRECTIONS = [
  { label: "front", prompt: "front view, facing camera, symmetrical" },
  { label: "back",  prompt: "back view, facing away from camera, symmetrical" },
  { label: "left",  prompt: "left side profile, facing left" },
  { label: "right", prompt: "right side profile, facing right" },
] as const;

const FRAME_VARIANTS = [
  { label: "rest", prompt: "resting position" },
  { label: "move", prompt: "slight movement, wind blown" },
] as const;

async function generateFrame(
  replicateToken: string,
  basePrompt: string,
  dirPrompt: string,
  framePrompt: string,
  dims: { width: number; height: number },
  label: string
): Promise<string | null> {
  const fullPrompt = `${basePrompt}, ${dirPrompt}, ${framePrompt}`;

  try {
    const response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        "Prefer": "wait",
      },
      body: JSON.stringify({
        version: "retro-diffusion/rd-fast",
        input: {
          prompt: fullPrompt,
          negative_prompt:
            "character, person, body, legs, arms, head, face, humanoid, figure",
          style: "game_asset",
          width: dims.width,
          height: dims.height,
          remove_bg: true,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[${label}] Replicate HTTP ${response.status}:`, errorText);
      return null;
    }

    const prediction = await response.json();
    const imageUrl = prediction.output?.[0];

    if (!imageUrl) {
      console.error(`[${label}] No image in response:`, JSON.stringify(prediction));
      return null;
    }

    const imageRes = await fetch(imageUrl);
    const buffer = await imageRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString("base64");
    return `data:image/png;base64,${base64}`;
  } catch (err) {
    console.error(`[${label}] generateFrame error:`, (err as Error).message);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const { prompt, accessoryType } = await req.json();
  const replicateToken = process.env.REPLICATE_API_TOKEN;

  if (!replicateToken) {
    return NextResponse.json({ error: "Missing Replicate token" }, { status: 500 });
  }

  const itemType = accessoryType ?? "accessory";
  const prefix = ACCESSORY_PROMPT_PREFIX[itemType] ?? `${itemType} item, isolated`;
  const dims = ACCESSORY_DIMENSIONS[itemType] ?? { width: 24, height: 24 };

  const basePrompt = `${prefix}, ${prompt}, no character, no person, no body, no legs, no arms, no head, floating item, transparent background, pixel art, GBA style, 6 colors max`;

  // Generate 2 frames per direction (8 total calls in parallel)
  const callMeta: { dir: string; frame: string }[] = [];
  const calls = DIRECTIONS.flatMap((dir) =>
    FRAME_VARIANTS.map((frame) => {
      const label = `${dir.label}-${frame.label}`;
      callMeta.push({ dir: dir.label, frame: frame.label });
      return generateFrame(replicateToken, basePrompt, dir.prompt, frame.prompt, dims, label);
    })
  );

  const results = await Promise.all(calls);

  // Log failures
  const failed = callMeta.filter((_, i) => results[i] === null);
  if (failed.length > 0) {
    console.warn(
      `Accessory generation: ${failed.length}/8 calls failed:`,
      failed.map((m) => `${m.dir}-${m.frame}`).join(", ")
    );
  }

  // If ALL failed, return error
  if (results.every((r) => r === null)) {
    return NextResponse.json(
      { error: "All 8 generation calls failed — check server logs for details" },
      { status: 500 }
    );
  }

  // results order: [front-rest, front-move, back-rest, back-move, left-rest, left-move, right-rest, right-move]
  return NextResponse.json({
    images: {
      front: [results[0], results[1]],
      back:  [results[2], results[3]],
      left:  [results[4], results[5]],
      right: [results[6], results[7]],
    },
    originalPrompt: prompt,
  });
}
