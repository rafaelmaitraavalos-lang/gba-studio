import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  const { name, personality } = (await req.json()) as { name: string; personality: string };
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    return NextResponse.json({ error: "Missing Anthropic API key" }, { status: 500 });
  }

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      system: `You are a game dialogue writer for a GBA-style RPG. Generate 4-6 natural, concise dialogue lines for an NPC. Each line should be short (under 60 characters), feel authentic to the character's personality, and be written as direct speech without quotation marks or line numbers. Return only the dialogue lines, one per line, nothing else.`,
      messages: [{ role: "user", content: `NPC Name: ${name}\nPersonality: ${personality}` }],
    });
    if (msg.content[0].type !== "text") {
      return NextResponse.json({ error: "No text response" }, { status: 500 });
    }
    const lines = msg.content[0].text
      .split("\n")
      .map((l) => l.replace(/^[-•*\d.]+\s*/, "").trim())
      .filter((l) => l.length > 0)
      .slice(0, 6);
    return NextResponse.json({ lines });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
