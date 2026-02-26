export const GRID_SIZE = 64;
export const PIXEL_DISPLAY_SIZE = 4;
export const CANVAS_SIZE = GRID_SIZE * PIXEL_DISPLAY_SIZE; // 256
export const FRAME_ANIMATION_DELAY = 150;

export const GBA_PALETTE: string[] = [
  "#FFCC99", "#CC8855", "#332211", "#FFDD00",
  "#2244CC", "#CC2222", "#228833", "#AAAAAA",
  "#111111", "#FFFFFF", "#44AAFF", "#FFAA00",
  "#884411", "#55CC55", "#CC55CC", "#000000",
];

export type PixelData = (string | null)[][];
export type Direction = "down" | "up" | "left" | "right";
export type FrameIndex = 0 | 1 | 2 | 3;
export type FrameTuple = [PixelData, PixelData, PixelData, PixelData];

export interface CharacterSprite {
  name: string;
  frames: {
    walkDown: FrameTuple;
    walkUp: FrameTuple;
    walkLeft: FrameTuple;
    walkRight: FrameTuple;
  };
}

/* ── Layer-based character system ── */

export interface CharacterLayer {
  id: string;
  name: string;           // e.g. "base", "clothing", "hat", "cape", "weapon"
  spritesheet: string;    // base64 data URI of the 4x4 spritesheet image
  zIndex: number;
}

export interface LayeredCharacter {
  name: string;
  layers: CharacterLayer[];
}

export function createEmptyLayeredCharacter(): LayeredCharacter {
  return { name: "New Character", layers: [] };
}

export function createEmptyPixelData(): PixelData {
  return Array.from({ length: GRID_SIZE }, () =>
    Array<string | null>(GRID_SIZE).fill(null)
  );
}

export function createEmptySprite(): CharacterSprite {
  return {
    name: "New Character",
    frames: {
      walkDown: [createEmptyPixelData(), createEmptyPixelData(), createEmptyPixelData(), createEmptyPixelData()],
      walkUp: [createEmptyPixelData(), createEmptyPixelData(), createEmptyPixelData(), createEmptyPixelData()],
      walkLeft: [createEmptyPixelData(), createEmptyPixelData(), createEmptyPixelData(), createEmptyPixelData()],
      walkRight: [createEmptyPixelData(), createEmptyPixelData(), createEmptyPixelData(), createEmptyPixelData()],
    },
  };
}

const DIRECTION_KEYS: Record<Direction, keyof CharacterSprite["frames"]> = {
  down: "walkDown",
  up: "walkUp",
  left: "walkLeft",
  right: "walkRight",
};

export function directionKey(dir: Direction): keyof CharacterSprite["frames"] {
  return DIRECTION_KEYS[dir];
}

export function floodFill(
  grid: PixelData,
  startRow: number,
  startCol: number,
  fillColor: string | null
): PixelData {
  const targetColor = grid[startRow][startCol];
  if (targetColor === fillColor) return grid;

  const newGrid = grid.map((r) => [...r]);
  const queue: [number, number][] = [[startRow, startCol]];
  const visited = new Set<string>();
  visited.add(`${startRow},${startCol}`);

  while (queue.length > 0) {
    const [row, col] = queue.shift()!;
    newGrid[row][col] = fillColor;

    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const nr = row + dr;
      const nc = col + dc;
      const key = `${nr},${nc}`;
      if (
        nr >= 0 && nr < GRID_SIZE &&
        nc >= 0 && nc < GRID_SIZE &&
        !visited.has(key) &&
        newGrid[nr][nc] === targetColor
      ) {
        visited.add(key);
        queue.push([nr, nc]);
      }
    }
  }

  return newGrid;
}
