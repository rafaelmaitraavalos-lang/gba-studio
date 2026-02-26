import {
  collection,
  addDoc,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  query,
  orderBy,
  serverTimestamp,
} from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import type { CustomTile } from "./tiles";

export type RoomType = "room" | "hallway";

export interface PlayerStart {
  row: number;
  col: number;
}

export interface ObjectInstance {
  id: string;
  type: string;
  row: number;
  col: number;
  properties: Record<string, unknown>;
  sprite?: string; // base64 data URI for AI-generated sprite
}

export interface RoomData {
  id: string;
  name: string;
  type: RoomType;
  cols: number;
  rows: number;
  tiles: string[];
  objects: ObjectInstance[];
  playerStart: PlayerStart | null;
  customTiles?: CustomTile[];
}

export const ROOM_DIMENSIONS = { cols: 16, rows: 10 } as const;
export const HALLWAY_DIMENSIONS = { cols: 6, rows: 20 } as const;

export function getDimensions(type: RoomType) {
  return type === "hallway" ? HALLWAY_DIMENSIONS : ROOM_DIMENSIONS;
}

export function createEmptyTiles(cols: number, rows: number): string[] {
  return Array(cols * rows).fill("");
}

export function tilesToGrid(tiles: string[], cols: number, rows: number): (string | null)[][] {
  const grid: (string | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: (string | null)[] = [];
    for (let c = 0; c < cols; c++) {
      const val = tiles[r * cols + c];
      row.push(val || null);
    }
    grid.push(row);
  }
  return grid;
}

export function gridToTiles(grid: (string | null)[][], cols: number, rows: number): string[] {
  const tiles: string[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      tiles.push(grid[r]?.[c] ?? "");
    }
  }
  return tiles;
}

function roomsCollection(uid: string, projectId: string) {
  return collection(getFirebaseDb(), "users", uid, "projects", projectId, "rooms");
}

function roomDoc(uid: string, projectId: string, roomId: string) {
  return doc(getFirebaseDb(), "users", uid, "projects", projectId, "rooms", roomId);
}

export async function createRoom(
  uid: string,
  projectId: string,
  name: string,
  type: RoomType
): Promise<RoomData> {
  const dims = getDimensions(type);
  const tiles = createEmptyTiles(dims.cols, dims.rows);
  const docRef = await addDoc(roomsCollection(uid, projectId), {
    name,
    type,
    cols: dims.cols,
    rows: dims.rows,
    tiles,
    objects: [],
    playerStart: null,
    customTiles: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return {
    id: docRef.id,
    name,
    type,
    cols: dims.cols,
    rows: dims.rows,
    tiles,
    objects: [],
    playerStart: null,
    customTiles: [],
  };
}

export async function loadRooms(uid: string, projectId: string): Promise<RoomData[]> {
  const q = query(roomsCollection(uid, projectId), orderBy("createdAt", "asc"));
  const snapshot = await getDocs(q);
  return snapshot.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      name: data.name ?? "Untitled",
      type: (data.type as RoomType) ?? "room",
      cols: data.cols ?? ROOM_DIMENSIONS.cols,
      rows: data.rows ?? ROOM_DIMENSIONS.rows,
      tiles: data.tiles ?? [],
      objects: data.objects ?? [],
      playerStart: data.playerStart ?? null,
      customTiles: (data.customTiles as CustomTile[]) ?? [],
    };
  });
}

export async function saveRoom(uid: string, projectId: string, room: RoomData): Promise<void> {
  await setDoc(
    roomDoc(uid, projectId, room.id),
    {
      name: room.name,
      type: room.type,
      cols: room.cols,
      rows: room.rows,
      tiles: room.tiles,
      objects: room.objects,
      playerStart: room.playerStart,
      customTiles: room.customTiles ?? [],
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

export async function deleteRoom(uid: string, projectId: string, roomId: string): Promise<void> {
  await deleteDoc(roomDoc(uid, projectId, roomId));
}
