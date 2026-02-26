import type { RoomData, ObjectInstance } from "./rooms";
import { TILE_TYPES, isCustomTileId } from "./tiles";
import type { LayeredCharacter } from "./characters";

export interface GameState {
  currentRoomId: string;
  playerPos: { row: number; col: number };
  playerDirection: "up" | "down" | "left" | "right";
  playerCharacter: LayeredCharacter | null;
  playerFrame: number;
  rooms: Map<string, RoomData>;
  isPaused: boolean;
  activeInteraction: Interaction | null;
  collectedChests: Set<string>;
}

export type Interaction =
  | { type: "chest"; item: string; objectId: string }
  | { type: "npc"; dialogue: string }
  | { type: "sign"; text: string }
  | { type: "enemy"; hp: number; damage: number }
  | { type: "door"; targetRoomId: string };

export function initGameState(rooms: RoomData[]): GameState {
  const roomMap = new Map<string, RoomData>();
  rooms.forEach((r) => roomMap.set(r.id, r));

  // Find the room with a playerStart, or use first room
  let startRoom = rooms.find((r) => r.playerStart !== null) ?? rooms[0];
  const playerPos = startRoom?.playerStart ?? { row: 0, col: 0 };

  return {
    currentRoomId: startRoom?.id ?? "",
    playerPos,
    playerDirection: "down",
    playerCharacter: null,
    playerFrame: 0,
    rooms: roomMap,
    isPaused: false,
    activeInteraction: null,
    collectedChests: new Set(),
  };
}

export function checkCollision(room: RoomData, row: number, col: number): boolean {
  if (row < 0 || row >= room.rows || col < 0 || col >= room.cols) return true;
  const tileId = room.tiles[row * room.cols + col];
  if (!tileId) return false;
  // Wall and water are impassable
  if (tileId === "wall" || tileId === "water") return true;
  // Custom tiles check walkable property
  if (isCustomTileId(tileId)) {
    const customTile = room.customTiles?.find((ct) => ct.id === tileId);
    if (customTile && !customTile.walkable) return true;
  }
  return false;
}

export function checkInteraction(
  room: RoomData,
  row: number,
  col: number,
  collectedChests: Set<string>
): Interaction | null {
  const obj = room.objects.find((o) => o.row === row && o.col === col);
  if (!obj) return null;

  switch (obj.type) {
    case "door":
      return { type: "door", targetRoomId: (obj.properties.targetRoomId as string) ?? "" };
    case "chest": {
      const key = `${room.id}:${obj.id}`;
      if (collectedChests.has(key)) return null;
      return { type: "chest", item: (obj.properties.item as string) ?? "Item", objectId: key };
    }
    case "npc":
      return { type: "npc", dialogue: (obj.properties.dialogue as string) ?? "..." };
    case "enemy":
      return {
        type: "enemy",
        hp: (obj.properties.hp as number) ?? 10,
        damage: (obj.properties.damage as number) ?? 2,
      };
    case "sign":
      return { type: "sign", text: (obj.properties.text as string) ?? "" };
    default:
      return null;
  }
}

type Direction = "up" | "down" | "left" | "right";

const DELTAS: Record<Direction, { dr: number; dc: number }> = {
  up: { dr: -1, dc: 0 },
  down: { dr: 1, dc: 0 },
  left: { dr: 0, dc: -1 },
  right: { dr: 0, dc: 1 },
};

export function movePlayer(state: GameState, direction: Direction): GameState {
  if (state.isPaused || state.activeInteraction) return state;

  const room = state.rooms.get(state.currentRoomId);
  if (!room) return state;

  const { dr, dc } = DELTAS[direction];
  const newRow = state.playerPos.row + dr;
  const newCol = state.playerPos.col + dc;

  const newState = { ...state, playerDirection: direction, playerFrame: (state.playerFrame + 1) % 4 };

  if (checkCollision(room, newRow, newCol)) {
    return newState;
  }

  newState.playerPos = { row: newRow, col: newCol };

  // Check for interaction at new position
  const interaction = checkInteraction(room, newRow, newCol, state.collectedChests);
  if (interaction) {
    if (interaction.type === "door" && interaction.targetRoomId) {
      const targetRoom = state.rooms.get(interaction.targetRoomId);
      if (targetRoom) {
        return {
          ...newState,
          currentRoomId: interaction.targetRoomId,
          playerPos: targetRoom.playerStart ?? { row: 0, col: 0 },
        };
      }
    }
    newState.activeInteraction = interaction;
    if (interaction.type === "chest") {
      newState.collectedChests = new Set(state.collectedChests);
      newState.collectedChests.add(interaction.objectId);
    }
  }

  return newState;
}
