import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

interface DoorConfig {
  wall: "north" | "south" | "east" | "west";
  label: string;
}

interface ClaudeResponse {
  grid: string[][];
  doors: { wall: string; x: number; label: string }[];
  enhancedPrompt: string;
}

const CLAUDE_SYSTEM = `You are a GBA top-down room designer. Return ONLY valid JSON with a 15x11 tile grid, door positions, and an enhanced image generation prompt. The enhanced prompt must describe exact object positions, wall material, floor material, lighting, and door positions for a pixel art dungeon map generator. Be extremely specific about what is in each corner and on each wall.

Grid is 15 columns x 11 rows. Tile codes:
W = wall
F = floor
D = door gap
C = chest
T = torch
B = barrel
S = statue

Rules:
- Row 0 is the north wall, row 10 is the south wall
- Column 0 is the west wall, column 14 is the east wall
- All border cells must be W except where doors are placed (D)
- Doors on north/south walls replace one cell in row 0 or row 10 at the specified column
- Doors on east/west walls replace one cell in column 0 or column 14 at the specified row
- Interior cells (rows 1-9, cols 1-13) are F by default
- ONLY place C/T/B/S tiles if the user's description explicitly mentions that object (chest, torch, barrel, statue). If the user does not mention an object, do not place it. A plain room description means only W, F, and D tiles.

CRITICAL DOOR RULE: Place door gaps (D tiles) ONLY on the walls explicitly listed in the user's door configuration. Do not add any D tile on a wall that was not listed. If the user specified no doors, every single border cell must be W — no exceptions. Never invent extra doors.

Response format (JSON only, no markdown):
{"grid":[["W","W","W","W","W","W","W","W","W","W","W","W","W","W","W"],...],"doors":[{"wall":"south","x":7,"label":"village"}],"enhancedPrompt":"..."}`;

export async function POST(req: NextRequest) {
  const { description, doors, name } = (await req.json()) as {
    description: string;
    doors: DoorConfig[];
    name: string;
  };

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const replicateToken = process.env.REPLICATE_API_TOKEN;

  if (!anthropicKey) {
    return NextResponse.json({ error: "Missing Anthropic API key" }, { status: 500 });
  }
  if (!replicateToken) {
    return NextResponse.json({ error: "Missing Replicate API token" }, { status: 500 });
  }

  // ── Step 1: Claude generates tile grid + enhanced prompt ──
  const doorDesc = doors.length > 0
    ? `Doors: ${doors.map((d) => `${d.wall} wall → "${d.label}"`).join(", ")}`
    : "No doors.";

  const userMessage = `Room name: "${name}"\nDescription: ${description}\n${doorDesc}\n\nGenerate the 15x11 tile grid JSON, door positions, and enhanced prompt.`;

  let claude: ClaudeResponse;
  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey });
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 2048,
      system: CLAUDE_SYSTEM,
      messages: [{ role: "user", content: userMessage }],
    });

    const text = msg.content[0].type === "text" ? msg.content[0].text : "";
    const cleaned = text.replace(/```json\n?|\n?```/g, '').trim();
    claude = JSON.parse(cleaned) as ClaudeResponse;

    // ── Enforce door placement: strip spurious D tiles, add missing ones ──
    const requestedWalls = new Set(doors.map((d) => d.wall));
    const ROWS = 11;
    const COLS = 15;

    // Remove any D tiles Claude placed on walls the user did NOT configure
    for (let c = 0; c < COLS; c++) {
      if (claude.grid[0]?.[c] === "D" && !requestedWalls.has("north"))  claude.grid[0][c] = "W";
      if (claude.grid[10]?.[c] === "D" && !requestedWalls.has("south")) claude.grid[10][c] = "W";
    }
    for (let r = 0; r < ROWS; r++) {
      if (claude.grid[r]?.[0] === "D" && !requestedWalls.has("west"))  claude.grid[r][0] = "W";
      if (claude.grid[r]?.[14] === "D" && !requestedWalls.has("east")) claude.grid[r][14] = "W";
    }

    // Ensure each configured wall has at least one D tile
    for (const door of doors) {
      const mid = Math.round(
        door.wall === "north" || door.wall === "south" ? (COLS - 1) / 2 : (ROWS - 1) / 2
      );
      if (door.wall === "north") {
        const hasD = claude.grid[0].some((t) => t === "D");
        if (!hasD) claude.grid[0][mid] = "D";
      } else if (door.wall === "south") {
        const hasD = claude.grid[ROWS - 1].some((t) => t === "D");
        if (!hasD) claude.grid[ROWS - 1][mid] = "D";
      } else if (door.wall === "west") {
        const hasD = claude.grid.some((row) => row[0] === "D");
        if (!hasD) claude.grid[mid][0] = "D";
      } else if (door.wall === "east") {
        const hasD = claude.grid.some((row) => row[COLS - 1] === "D");
        if (!hasD) claude.grid[mid][COLS - 1] = "D";
      }
    }

    // Sync the doors array to match what's actually in the grid
    claude.doors = doors.map((door) => {
      if (door.wall === "north") {
        const x = claude.grid[0].findIndex((t) => t === "D");
        return { wall: "north", x: x >= 0 ? x : Math.round((COLS - 1) / 2), label: door.label };
      } else if (door.wall === "south") {
        const x = claude.grid[ROWS - 1].findIndex((t) => t === "D");
        return { wall: "south", x: x >= 0 ? x : Math.round((COLS - 1) / 2), label: door.label };
      } else if (door.wall === "west") {
        const x = claude.grid.findIndex((row) => row[0] === "D");
        return { wall: "west", x: x >= 0 ? x : Math.round((ROWS - 1) / 2), label: door.label };
      } else {
        const x = claude.grid.findIndex((row) => row[COLS - 1] === "D");
        return { wall: "east", x: x >= 0 ? x : Math.round((ROWS - 1) / 2), label: door.label };
      }
    });
  } catch (err) {
    console.error("Claude room generation failed:", err);
    return NextResponse.json(
      { error: `Claude error: ${(err as Error).message}` },
      { status: 500 }
    );
  }

  // ── Step 2: Retro Diffusion rd-pro dungeon map ──
  let imageBase64: string | null = null;
  try {
    const rdPrompt = `${claude.enhancedPrompt}, top-down view, GBA resolution, pixel art`;

    const response = await fetch("https://api.replicate.com/v1/models/retro-diffusion/rd-plus/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        "Prefer": "wait=60",
      },
      body: JSON.stringify({
        input: {
          prompt: rdPrompt,
          style: "topdown_map",
          width: 240,
          height: 160,
          num_images: 1,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Replicate rd-pro HTTP ${response.status}:`, errorText);
    } else {
      const prediction = await response.json();
      const imageUrl = prediction.output?.[0];

      if (imageUrl) {
        const imageRes = await fetch(imageUrl);
        const buffer = await imageRes.arrayBuffer();
        imageBase64 = `data:image/png;base64,${Buffer.from(buffer).toString("base64")}`;
      } else {
        console.error("rd-pro returned no image:", JSON.stringify(prediction));
      }
    }
  } catch (err) {
    console.error("rd-pro generation error:", (err as Error).message);
  }

  return NextResponse.json({
    grid: claude.grid,
    doors: claude.doors,
    image: imageBase64,
    enhancedPrompt: claude.enhancedPrompt,
  });
}
