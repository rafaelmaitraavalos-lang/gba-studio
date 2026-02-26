"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import {
  GRID_SIZE,
  type Direction,
  type LayeredCharacter,
  type CharacterLayer,
} from "@/lib/characters";

// ─── Constants ────────────────────────────────────────────────────────────────

const CANVAS_W = 480;
const CANVAS_H = 320;
const CHAR_SIZE = 64;
const TILE_PX = 32;
const MOVE_SPEED = 1;
const ANIM_INTERVAL = 150;
const DOOR_W = 40;
const DOOR_H = 60;
const OBJ_SIZE = 64;
const MOB_SIZE = 48;
const MOB_SPEED = 0.5;
const NPC_SIZE = 48;
const NPC_INTERACT_RANGE = 72;

const DIRECTION_TO_ROW: Record<Direction, number> = {
  up: 0, right: 1, down: 2, left: 3,
};

const SPAWN_FACING: Record<string, Direction> = {
  north: "up",
  east: "right",
  west: "left",
  south: "down",
};

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedCharacter {
  id: string;
  name: string;
  character: LayeredCharacter;
}

interface SavedObject {
  id: string;
  name: string;
  imageBase64: string;
}

interface PlacedDoor {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  wall: "north" | "east" | "west";
  linkedRoomId?: string;
}

interface PlacedObject {
  id: string;
  objectId: string;
  imageBase64: string;
  x: number;
  y: number;
  width: number;
  height: number;
  flippedH: boolean;
  flippedV: boolean;
}

interface SavedMob {
  id: string;
  name: string;
  spritesheet: string;
}

interface PlacedMob {
  id: string;
  mobId: string;
  spritesheet: string;
  x: number;
  y: number;
  patrolPath: { x: number; y: number }[];
}

interface MobState {
  x: number;
  y: number;
  dir: Direction;
  frame: number;
  lastAnimTick: number;
  pauseFrames: number;
  waypointIndex: number;
  wanderDx: number;
  wanderDy: number;
  wanderFrames: number;
}

type DialogueStyle = "rpg_banner" | "speech_bubble" | "parchment" | "typewriter" | "chat_box";

interface SavedNPC {
  id: string;
  name: string;
  spritesheet: string;
  isWalking: boolean;
  dialogue: string[];
  dialogueStyle: DialogueStyle;
}

interface PlacedNPC {
  id: string;
  npcId: string;
  spritesheet: string;
  isWalking: boolean;
  dialogue: string[];
  dialogueStyle: DialogueStyle;
  name: string;
  x: number;
  y: number;
}

interface NPCState {
  x: number;
  y: number;
  dir: Direction;
  frame: number;
  lastAnimTick: number;
  idleCounter: number;
  idleFrame: number;
  wanderDx: number;
  wanderDy: number;
  wanderFrames: number;
}

interface DialogueState {
  npcId: string;
  npcName: string;
  lines: string[];
  currentLine: number;
  style: DialogueStyle;
}

interface SidebarRoom {
  id: string;
  name: string;
  imageBase64: string;
  grid: string[][];
  placedDoors: PlacedDoor[];
  placedObjects: PlacedObject[];
  placedMobs: PlacedMob[];
  placedNPCs: PlacedNPC[];
}

interface SidebarAccessory {
  id: string;
  name: string;
  type: string;
  thumbUrl: string;
}

type SidebarTab = "rooms" | "characters" | "accessories" | "objects" | "mobs" | "npcs" | "editor" | null;

// ─── Spritesheet helpers ──────────────────────────────────────────────────────

function parseLayerSpritesheet(dataUri: string): Promise<HTMLCanvasElement[][]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const srcCanvas = document.createElement("canvas");
      srcCanvas.width = img.width;
      srcCanvas.height = img.height;
      const srcCtx = srcCanvas.getContext("2d")!;
      srcCtx.imageSmoothingEnabled = false;
      srcCtx.drawImage(img, 0, 0);
      const frameW = img.width / 4;
      const frameH = img.height / 4;
      const rows: HTMLCanvasElement[][] = [];
      for (let row = 0; row < 4; row++) {
        const cols: HTMLCanvasElement[] = [];
        for (let col = 0; col < 4; col++) {
          const c = document.createElement("canvas");
          c.width = GRID_SIZE;
          c.height = GRID_SIZE;
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(srcCanvas, col * frameW, row * frameH, frameW, frameH, 0, 0, GRID_SIZE, GRID_SIZE);
          cols.push(c);
        }
        rows.push(cols);
      }
      resolve(rows);
    };
    img.onerror = () => reject(new Error("Failed to load spritesheet"));
    img.src = dataUri;
  });
}

async function preRenderCompositeFrames(layers: CharacterLayer[]): Promise<Map<string, HTMLCanvasElement>> {
  const cache = new Map<string, HTMLCanvasElement>();
  if (layers.length === 0) return cache;
  const sorted = [...layers].sort((a, b) => a.zIndex - b.zIndex);
  const parsedLayers: HTMLCanvasElement[][][] = [];
  for (const layer of sorted) {
    if (!layer.spritesheet) continue;
    try {
      parsedLayers.push(await parseLayerSpritesheet(layer.spritesheet));
    } catch (err) {
      console.warn(`Failed to parse layer ${layer.name}:`, err);
    }
  }
  if (parsedLayers.length === 0) return cache;
  for (const [dir, rowIdx] of Object.entries(DIRECTION_TO_ROW)) {
    for (let fi = 0; fi < 4; fi++) {
      const composite = document.createElement("canvas");
      composite.width = GRID_SIZE;
      composite.height = GRID_SIZE;
      const ctx = composite.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      for (const parsed of parsedLayers) {
        if (parsed[rowIdx]?.[fi]) ctx.drawImage(parsed[rowIdx][fi], 0, 0);
      }
      cache.set(`${dir}:${fi}`, composite);
    }
  }
  return cache;
}

function deserializeLayeredCharacter(docData: Record<string, unknown>): LayeredCharacter {
  const name = (docData.name as string) ?? "Character";
  const rawLayers = docData.layers as Array<{ id: string; name: string; spritesheet: string; zIndex: number }> | undefined;
  if (rawLayers && rawLayers.length > 0) {
    return { name, layers: rawLayers.map((l) => ({ id: l.id, name: l.name, spritesheet: l.spritesheet, zIndex: l.zIndex })) };
  }
  return { name, layers: [] };
}

// ─── Game helpers ─────────────────────────────────────────────────────────────

function isBlocked(grid: string[][] | null, x: number, y: number): boolean {
  if (!grid || grid.length === 0) return false;
  const rows = grid.length;
  const cols = grid[0].length;
  const corners: [number, number][] = [
    [x, y], [x + CHAR_SIZE - 1, y],
    [x, y + CHAR_SIZE - 1], [x + CHAR_SIZE - 1, y + CHAR_SIZE - 1],
  ];
  for (const [cx, cy] of corners) {
    const col = Math.floor(cx / TILE_PX);
    const row = Math.floor(cy / TILE_PX);
    if (row < 0 || col < 0 || row >= rows || col >= cols) return true;
    if (grid[row][col] === "W") return true;
  }
  return false;
}

function isBlockedByObject(objects: PlacedObject[], x: number, y: number): boolean {
  // Use the player's feet area (bottom half) for a natural feel
  const feetTop    = y + Math.floor(CHAR_SIZE / 2);
  const feetBottom = y + CHAR_SIZE;
  const feetLeft   = x;
  const feetRight  = x + CHAR_SIZE;
  for (const po of objects) {
    // Tighter collision box: bottom 40% height, middle 60% width
    const colX = po.x + po.width  * 0.2;
    const colW = po.width  * 0.6;
    const colY = po.y + po.height * 0.6;
    const colH = po.height * 0.4;
    if (
      feetLeft  < colX + colW &&
      feetRight > colX        &&
      feetTop   < colY + colH &&
      feetBottom > colY
    ) return true;
  }
  return false;
}

function decodeRoomImage(imageBase64: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const off = document.createElement("canvas");
      off.width = CANVAS_W;
      off.height = CANVAS_H;
      const ctx = off.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
      resolve(off);
    };
    img.onerror = () => reject(new Error("Failed to decode room image"));
    img.src = imageBase64;
  });
}

function parseMobSpritesheet(dataUri: string): Promise<HTMLCanvasElement[][]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const frameW = img.width / 4;
      const frameH = img.height / 4;
      const rows: HTMLCanvasElement[][] = [];
      for (let row = 0; row < 4; row++) {
        const cols: HTMLCanvasElement[] = [];
        for (let col = 0; col < 4; col++) {
          const c = document.createElement("canvas");
          c.width = MOB_SIZE;
          c.height = MOB_SIZE;
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH, 0, 0, MOB_SIZE, MOB_SIZE);
          cols.push(c);
        }
        rows.push(cols);
      }
      resolve(rows);
    };
    img.onerror = () => reject(new Error("Failed to load mob spritesheet"));
    img.src = dataUri;
  });
}

function updateMobState(state: MobState, mob: PlacedMob, ts: number): MobState {
  const path = mob.patrolPath;
  let { x, y, dir, frame, lastAnimTick, pauseFrames, waypointIndex, wanderDx, wanderDy, wanderFrames } = state;
  let moving = false;

  if (path.length >= 2) {
    if (pauseFrames > 0) {
      pauseFrames--;
    } else {
      const target = path[waypointIndex % path.length];
      const dx = target.x - x;
      const dy = target.y - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= MOB_SPEED) {
        x = target.x;
        y = target.y;
        waypointIndex = (waypointIndex + 1) % path.length;
        pauseFrames = 30;
      } else {
        const nx = dx / dist;
        const ny = dy / dist;
        x += nx * MOB_SPEED;
        y += ny * MOB_SPEED;
        moving = true;
        dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : (dy > 0 ? "down" : "up");
      }
    }
  } else {
    if (wanderFrames <= 0) {
      const angle = Math.random() * Math.PI * 2;
      wanderDx = Math.cos(angle);
      wanderDy = Math.sin(angle);
      wanderFrames = 60 + Math.floor(Math.random() * 60);
    }
    wanderFrames--;
    const nx = x + wanderDx * MOB_SPEED;
    const ny = y + wanderDy * MOB_SPEED;
    if (nx >= 0 && nx <= CANVAS_W - MOB_SIZE) { x = nx; moving = true; }
    else { wanderDx = -wanderDx; wanderFrames = 0; }
    if (ny >= 0 && ny <= CANVAS_H - MOB_SIZE) { y = ny; moving = true; }
    else { wanderDy = -wanderDy; wanderFrames = 0; }
    if (moving) {
      dir = Math.abs(wanderDx) > Math.abs(wanderDy)
        ? (wanderDx > 0 ? "right" : "left")
        : (wanderDy > 0 ? "down" : "up");
    }
  }

  if (moving) {
    if (ts - lastAnimTick >= ANIM_INTERVAL) {
      frame = (frame + 1) % 2;
      lastAnimTick = ts;
    }
  } else {
    frame = 0;
  }

  return { x, y, dir, frame, lastAnimTick, pauseFrames, waypointIndex, wanderDx, wanderDy, wanderFrames };
}

function updateNPCState(state: NPCState, npc: PlacedNPC, ts: number): NPCState {
  let { x, y, dir, frame, lastAnimTick, idleCounter, idleFrame, wanderDx, wanderDy, wanderFrames } = state;

  if (npc.isWalking) {
    let moving = false;
    if (wanderFrames <= 0) {
      const angle = Math.random() * Math.PI * 2;
      wanderDx = Math.cos(angle);
      wanderDy = Math.sin(angle);
      wanderFrames = 80 + Math.floor(Math.random() * 80);
    }
    wanderFrames--;
    const nx = x + wanderDx * MOB_SPEED;
    const ny = y + wanderDy * MOB_SPEED;
    if (nx >= 0 && nx <= CANVAS_W - NPC_SIZE) { x = nx; moving = true; }
    else { wanderDx = -wanderDx; wanderFrames = 0; }
    if (ny >= 0 && ny <= CANVAS_H - NPC_SIZE) { y = ny; moving = true; }
    else { wanderDy = -wanderDy; wanderFrames = 0; }
    if (moving) {
      dir = Math.abs(wanderDx) > Math.abs(wanderDy)
        ? (wanderDx > 0 ? "right" : "left")
        : (wanderDy > 0 ? "down" : "up");
    }
    if (moving && ts - lastAnimTick >= ANIM_INTERVAL) {
      frame = (frame + 1) % 4;
      lastAnimTick = ts;
    } else if (!moving) {
      frame = 0;
    }
  } else {
    // Idle: subtle breathing — alternate between frame 0 and 1 every ~40 frames
    idleCounter--;
    if (idleCounter <= 0) {
      idleFrame = 1 - idleFrame;
      idleCounter = 40;
    }
    frame = idleFrame;
  }

  return { x, y, dir, frame, lastAnimTick, idleCounter, idleFrame, wanderDx, wanderDy, wanderFrames };
}

function drawCheckerboard(ctx: CanvasRenderingContext2D) {
  const cell = 16;
  for (let y = 0; y < CANVAS_H; y += cell) {
    for (let x = 0; x < CANVAS_W; x += cell) {
      ctx.fillStyle = ((x / cell + y / cell) % 2 === 0) ? "#1F2937" : "#111827";
      ctx.fillRect(x, y, cell, cell);
    }
  }
}

function getCanvasCoords(
  e: React.MouseEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
): { cx: number; cy: number } {
  const rect = canvas.getBoundingClientRect();
  const borderPx = parseFloat(getComputedStyle(canvas).borderLeftWidth) || 0;
  const drawW = rect.width - borderPx * 2;
  const drawH = rect.height - borderPx * 2;
  return {
    cx: ((e.clientX - rect.left - borderPx) / drawW) * canvas.width,
    cy: ((e.clientY - rect.top - borderPx) / drawH) * canvas.height,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function BuilderMode() {
  const { user, loading } = useAuth();
  const { projectId, projectName } = useProject();
  const router = useRouter();

  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Movement refs
  const pixelPosRef = useRef({ x: Math.round(CANVAS_W / 2 - CHAR_SIZE / 2), y: Math.round(CANVAS_H / 2 - CHAR_SIZE / 2) });
  const keysHeldRef = useRef<Set<string>>(new Set());
  const playerDirRef = useRef<Direction>("down");
  const playerFrameRef = useRef(0);
  const lastAnimTickRef = useRef(0);
  const rafIdRef = useRef(0);

  // Room refs
  const roomBgRef = useRef<HTMLCanvasElement | null>(null);
  const roomGridRef = useRef<string[][] | null>(null);
  const roomBgCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const currentRoomIdRef = useRef<string | null>(null);
  const previousRoomIdRef = useRef<string | null>(null);

  // Placed door refs
  const placedDoorsRef = useRef<PlacedDoor[]>([]);
  const isEditorModeRef = useRef(false);
  const draggingDoorRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);

  // Placed object refs
  const placedObjectsRef = useRef<PlacedObject[]>([]);
  const draggingObjectRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const objectImgCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const editorToolRef = useRef<"door" | "object" | "mob" | "npc" | null>(null);
  const selectedObjectRef = useRef<SavedObject | null>(null);
  const resizingObjectRef = useRef<{ id: string; startMouseX: number; startMouseY: number; startW: number; startH: number } | null>(null);

  // Placed mob refs
  const placedMobsRef = useRef<PlacedMob[]>([]);
  const draggingMobRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const mobStatesRef = useRef<Map<string, MobState>>(new Map());
  const mobFrameCacheRef = useRef<Map<string, HTMLCanvasElement[][]>>(new Map());
  const selectedMobSourceRef = useRef<SavedMob | null>(null);
  const editingMobPathIdRef = useRef<string | null>(null);
  const selectedMobInstanceIdRef = useRef<string | null>(null);

  // Placed NPC refs
  const placedNPCsRef = useRef<PlacedNPC[]>([]);
  const draggingNPCRef = useRef<{ id: string; offsetX: number; offsetY: number } | null>(null);
  const npcStatesRef = useRef<Map<string, NPCState>>(new Map());
  const npcFrameCacheRef = useRef<Map<string, HTMLCanvasElement[][]>>(new Map());
  const selectedNPCSourceRef = useRef<SavedNPC | null>(null);
  const selectedNPCInstanceIdRef = useRef<string | null>(null);
  const activeDialogueRef = useRef<DialogueState | null>(null);
  const npcLineIndexRef = useRef<Map<string, number>>(new Map());
  const npcPromptAlphaRef = useRef<Map<string, number>>(new Map());

  // Character cache
  const charFrameCacheRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  // Transition refs
  const isTransitioningRef = useRef(false);
  const fadeRef = useRef({ opacity: 0 });
  const transitionCooldownRef = useRef(0);
  const spawnGraceFramesRef = useRef(0);

  // ── State ────────────────────────────────────────────────────────────────────

  const [characters, setCharacters] = useState<SavedCharacter[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [charThumbs, setCharThumbs] = useState<Record<string, string>>({});
  const [savedRooms, setSavedRooms] = useState<SidebarRoom[]>([]);
  const [savedAccessories, setSavedAccessories] = useState<SidebarAccessory[]>([]);
  const [savedObjects, setSavedObjects] = useState<SavedObject[]>([]);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [placedObjects, setPlacedObjects] = useState<PlacedObject[]>([]);
  const [savedMobs, setSavedMobs] = useState<SavedMob[]>([]);
  const [selectedMobSourceId, setSelectedMobSourceId] = useState<string | null>(null);
  const [placedMobs, setPlacedMobs] = useState<PlacedMob[]>([]);
  const [selectedMobInstanceId, setSelectedMobInstanceId] = useState<string | null>(null);
  const [editingMobPathId, setEditingMobPathId] = useState<string | null>(null);
  const [savedNPCs, setSavedNPCs] = useState<SavedNPC[]>([]);
  const [selectedNPCSourceId, setSelectedNPCSourceId] = useState<string | null>(null);
  const [placedNPCs, setPlacedNPCs] = useState<PlacedNPC[]>([]);
  const [selectedNPCInstanceId, setSelectedNPCInstanceId] = useState<string | null>(null);
  const [activeDialogue, setActiveDialogue] = useState<DialogueState | null>(null);
  const [activeTab, setActiveTab] = useState<SidebarTab>("rooms");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditorMode, setIsEditorMode] = useState(false);
  const [editorTool, setEditorTool] = useState<"door" | "object" | "mob" | "npc" | null>(null);
  const [placedDoors, setPlacedDoors] = useState<PlacedDoor[]>([]);
  const [pendingDoor, setPendingDoor] = useState<{ x: number; y: number } | null>(null);

  // Keep refs in sync with state (synchronous, runs every render)
  const savedRoomsRef = useRef<SidebarRoom[]>([]);
  const savedObjectsRef = useRef<SavedObject[]>([]);
  savedRoomsRef.current = savedRooms;
  savedObjectsRef.current = savedObjects;
  placedDoorsRef.current = placedDoors;
  placedObjectsRef.current = placedObjects;
  placedMobsRef.current = placedMobs;
  isEditorModeRef.current = isEditorMode;
  editorToolRef.current = editorTool;
  selectedObjectRef.current = savedObjects.find((o) => o.id === selectedObjectId) ?? null;
  selectedMobSourceRef.current = savedMobs.find((m) => m.id === selectedMobSourceId) ?? null;
  editingMobPathIdRef.current = editingMobPathId;
  selectedMobInstanceIdRef.current = selectedMobInstanceId;
  placedNPCsRef.current = placedNPCs;
  selectedNPCSourceRef.current = savedNPCs.find((n) => n.id === selectedNPCSourceId) ?? null;
  selectedNPCInstanceIdRef.current = selectedNPCInstanceId;

  // ── Auth guard ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // ── Load characters ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "characters")).then(async (snap) => {
      const chars: SavedCharacter[] = snap.docs.map((d) => {
        const character = deserializeLayeredCharacter(d.data() as Record<string, unknown>);
        return { id: d.id, name: character.name, character };
      });
      setCharacters(chars);
      if (chars.length > 0) setSelectedCharId(chars[0].id);
      const thumbEntries = await Promise.all(
        chars.map(async (char) => {
          if (char.character.layers.length === 0) return [char.id, ""] as const;
          try {
            const cache = await preRenderCompositeFrames(char.character.layers);
            const frame = cache.get("down:0");
            return [char.id, frame ? frame.toDataURL() : ""] as const;
          } catch {
            return [char.id, ""] as const;
          }
        })
      );
      setCharThumbs(Object.fromEntries(thumbEntries));
    });
  }, [user, projectId]);

  // ── Load rooms ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "rooms")).then((snap) => {
      const rooms: SidebarRoom[] = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) ?? "Room",
        imageBase64: (d.data().imageBase64 as string) ?? "",
        grid: d.data().gridJson ? (JSON.parse(d.data().gridJson as string) as string[][]) : [],
        placedDoors: (d.data().placedDoors as PlacedDoor[]) ?? [],
        placedObjects: (d.data().placedObjects as PlacedObject[]) ?? [],
        placedMobs: (d.data().placedMobs as PlacedMob[]) ?? [],
        placedNPCs: (d.data().placedNPCs as PlacedNPC[]) ?? [],
      }));
      setSavedRooms(rooms);
      rooms.forEach((room) => {
        if (!room.imageBase64) return;
        decodeRoomImage(room.imageBase64)
          .then((off) => roomBgCacheRef.current.set(room.id, off))
          .catch(() => {});
      });
    });
  }, [user, projectId]);

  // ── Load accessories ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "accessories")).then((snap) => {
      setSavedAccessories(
        snap.docs.map((d) => ({
          id: d.id,
          name: (d.data().name as string) ?? "Accessory",
          type: (d.data().type as string) ?? "",
          thumbUrl: (d.data().imageBase64 as string) ?? (d.data().imageUrl as string) ?? "",
        }))
      );
    });
  }, [user, projectId]);

  // ── Load objects ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "objects")).then((snap) => {
      const objs: SavedObject[] = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) ?? "Object",
        imageBase64: (d.data().imageBase64 as string) ?? "",
      }));
      setSavedObjects(objs);
      // Pre-load images into cache
      objs.forEach((obj) => {
        if (!obj.imageBase64 || objectImgCacheRef.current.has(obj.id)) return;
        const img = new Image();
        img.src = obj.imageBase64;
        objectImgCacheRef.current.set(obj.id, img);
      });
    });
  }, [user, projectId]);

  // ── Load mobs ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "mobs")).then((snap) => {
      const mobs: SavedMob[] = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) ?? "Mob",
        spritesheet: (d.data().spritesheet as string) ?? "",
      }));
      setSavedMobs(mobs);
      mobs.forEach((mob) => {
        if (!mob.spritesheet || mobFrameCacheRef.current.has(mob.id)) return;
        parseMobSpritesheet(mob.spritesheet)
          .then((frames) => mobFrameCacheRef.current.set(mob.id, frames))
          .catch(() => {});
      });
    });
  }, [user, projectId]);

  // ── Load NPCs ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "npcs")).then((snap) => {
      const npcs: SavedNPC[] = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) ?? "NPC",
        spritesheet: (d.data().spritesheet as string) ?? "",
        isWalking: (d.data().isWalking as boolean) ?? true,
        dialogue: (d.data().dialogue as string[]) ?? [],
        dialogueStyle: (d.data().dialogueStyle as DialogueStyle) ?? "rpg_banner",
      }));
      setSavedNPCs(npcs);
      npcs.forEach((npc) => {
        if (!npc.spritesheet || npcFrameCacheRef.current.has(npc.id)) return;
        parseMobSpritesheet(npc.spritesheet)
          .then((frames) => npcFrameCacheRef.current.set(npc.id, frames))
          .catch(() => {});
      });
    });
  }, [user, projectId]);

  // ── Sync NPC states when placedNPCs changes ───────────────────────────────────

  useEffect(() => {
    const existing = npcStatesRef.current;
    const next = new Map<string, NPCState>();
    for (const npc of placedNPCs) {
      const prev = existing.get(npc.id);
      if (prev) {
        next.set(npc.id, { ...prev, x: npc.x, y: npc.y });
      } else {
        next.set(npc.id, {
          x: npc.x,
          y: npc.y,
          dir: "down",
          frame: 0,
          lastAnimTick: 0,
          idleCounter: 40,
          idleFrame: 0,
          wanderDx: Math.random() > 0.5 ? MOB_SPEED : -MOB_SPEED,
          wanderDy: 0,
          wanderFrames: 80 + Math.floor(Math.random() * 80),
        });
      }
    }
    npcStatesRef.current = next;
  }, [placedNPCs]);

  // ── Sync mob states when placedMobs changes ────────────────────────────────────

  useEffect(() => {
    const existing = mobStatesRef.current;
    const next = new Map<string, MobState>();
    for (const mob of placedMobs) {
      const prev = existing.get(mob.id);
      if (prev) {
        next.set(mob.id, { ...prev, x: mob.x, y: mob.y });
      } else {
        next.set(mob.id, {
          x: mob.x,
          y: mob.y,
          dir: "down",
          frame: 0,
          lastAnimTick: 0,
          pauseFrames: 0,
          waypointIndex: 0,
          wanderDx: Math.random() > 0.5 ? MOB_SPEED : -MOB_SPEED,
          wanderDy: 0,
          wanderFrames: 60 + Math.floor(Math.random() * 60),
        });
      }
    }
    mobStatesRef.current = next;
  }, [placedMobs]);

  // ── Pre-render character frames ───────────────────────────────────────────────

  useEffect(() => {
    const char = characters.find((c) => c.id === selectedCharId);
    if (!char) return;
    charFrameCacheRef.current.clear();
    preRenderCompositeFrames(char.character.layers).then((cache) => {
      charFrameCacheRef.current = cache;
    });
  }, [selectedCharId, characters]);

  // ── Transition helpers ────────────────────────────────────────────────────────

  function animateFade(from: number, to: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      const start = performance.now();
      function tick(now: number) {
        const t = Math.min(1, (now - start) / duration);
        fadeRef.current.opacity = from + (to - from) * t;
        if (t < 1) requestAnimationFrame(tick);
        else resolve();
      }
      requestAnimationFrame(tick);
    });
  }

  function preloadPlacedObjectImages(objects: PlacedObject[]) {
    objects.forEach((po) => {
      if (!po.imageBase64 || objectImgCacheRef.current.has(po.objectId)) return;
      const img = new Image();
      img.src = po.imageBase64;
      objectImgCacheRef.current.set(po.objectId, img);
    });
  }

  async function applyRoomData(room: SidebarRoom) {
    roomGridRef.current = room.grid.length > 0 ? room.grid : null;
    placedDoorsRef.current = room.placedDoors ?? [];
    setPlacedDoors(room.placedDoors ?? []);
    const roomObjects = room.placedObjects ?? [];
    placedObjectsRef.current = roomObjects;
    setPlacedObjects(roomObjects);
    preloadPlacedObjectImages(roomObjects);
    const roomMobs = room.placedMobs ?? [];
    placedMobsRef.current = roomMobs;
    setPlacedMobs(roomMobs);
    const roomNPCs = room.placedNPCs ?? [];
    placedNPCsRef.current = roomNPCs;
    setPlacedNPCs(roomNPCs);
    activeDialogueRef.current = null;
    setActiveDialogue(null);
    const cached = roomBgCacheRef.current.get(room.id);
    if (cached) {
      roomBgRef.current = cached;
    } else if (room.imageBase64) {
      try {
        const off = await decodeRoomImage(room.imageBase64);
        roomBgCacheRef.current.set(room.id, off);
        roomBgRef.current = off;
      } catch {
        roomBgRef.current = null;
      }
    } else {
      roomBgRef.current = null;
    }
  }

  // Enter a room through a placed door (north/east/west)
  async function triggerTransition(targetRoomId: string, fromWall: string, fromDoor: PlacedDoor) {
    if (isTransitioningRef.current) return;
    const targetRoom = savedRoomsRef.current.find((r) => r.id === targetRoomId);
    if (!targetRoom) return;

    isTransitioningRef.current = true;
    keysHeldRef.current.clear();
    await animateFade(0, 1, 300);

    previousRoomIdRef.current = currentRoomIdRef.current;
    currentRoomIdRef.current = targetRoomId;
    await applyRoomData(targetRoom);

    const doorCY = fromDoor.y + (fromDoor.height ?? DOOR_H) / 2;
    console.log("doorCY", doorCY, "| fromDoor", JSON.stringify(fromDoor));
    switch (fromWall) {
      case "north": {
        const destSouthDoor = targetRoom.placedDoors.find((d) => (d.wall as string) === "south");
        const spawnX = destSouthDoor
          ? Math.round(destSouthDoor.x + destSouthDoor.width / 2 - CHAR_SIZE / 2)
          : Math.round(CANVAS_W / 2 - CHAR_SIZE / 2);
        pixelPosRef.current = { x: spawnX, y: CANVAS_H - CHAR_SIZE - 4 };
        break;
      }
      case "east":
        pixelPosRef.current = { x: 32, y: Math.round(doorCY - CHAR_SIZE / 2) };
        break;
      case "west":
        pixelPosRef.current = { x: CANVAS_W - CHAR_SIZE - 32, y: Math.round(doorCY - CHAR_SIZE / 2) };
        break;
      default:
        pixelPosRef.current = { x: Math.round(CANVAS_W / 2 - CHAR_SIZE / 2), y: Math.round(CANVAS_H / 2 - CHAR_SIZE / 2) };
    }
    playerDirRef.current = SPAWN_FACING[fromWall] ?? "down";
    spawnGraceFramesRef.current = 60;

    await animateFade(1, 0, 300);
    transitionCooldownRef.current = performance.now() + 1200;
    isTransitioningRef.current = false;
  }

  // Return to previous room via south exit
  async function triggerSouthExit() {
    if (isTransitioningRef.current) return;
    const prevId = previousRoomIdRef.current;
    if (!prevId) return;
    const prevRoom = savedRoomsRef.current.find((r) => r.id === prevId);
    if (!prevRoom) return;

    isTransitioningRef.current = true;
    keysHeldRef.current.clear();
    await animateFade(0, 1, 300);

    previousRoomIdRef.current = null;
    currentRoomIdRef.current = prevId;
    await applyRoomData(prevRoom);

    const northDoor = prevRoom.placedDoors.find((d) => d.wall === "north");
    const southExitX = northDoor
      ? Math.round(northDoor.x + northDoor.width / 2 - CHAR_SIZE / 2)
      : Math.round(CANVAS_W / 2 - CHAR_SIZE / 2);
    pixelPosRef.current = { x: southExitX, y: CHAR_SIZE + 20 };
    playerDirRef.current = "down";
    spawnGraceFramesRef.current = 60;

    await animateFade(1, 0, 300);
    transitionCooldownRef.current = performance.now() + 1200;
    isTransitioningRef.current = false;
  }

  function tryStartDialogue() {
    const playerCx = pixelPosRef.current.x + CHAR_SIZE / 2;
    const playerCy = pixelPosRef.current.y + CHAR_SIZE / 2;
    let bestNPC: PlacedNPC | null = null;
    let bestDist = NPC_INTERACT_RANGE;
    for (const npc of placedNPCsRef.current) {
      if (npc.dialogue.length === 0) continue;
      const state = npcStatesRef.current.get(npc.id);
      const npcCx = (state?.x ?? npc.x) + NPC_SIZE / 2;
      const npcCy = (state?.y ?? npc.y) + NPC_SIZE / 2;
      const dist = Math.sqrt((playerCx - npcCx) ** 2 + (playerCy - npcCy) ** 2);
      if (dist < bestDist) { bestDist = dist; bestNPC = npc; }
    }
    if (bestNPC) {
      const lineIndex = npcLineIndexRef.current.get(bestNPC.id) ?? 0;
      npcLineIndexRef.current.set(bestNPC.id, (lineIndex + 1) % bestNPC.dialogue.length);
      const dlg: DialogueState = {
        npcId: bestNPC.id,
        npcName: bestNPC.name,
        lines: [bestNPC.dialogue[lineIndex]],
        currentLine: 0,
        style: bestNPC.dialogueStyle,
      };
      activeDialogueRef.current = dlg;
      setActiveDialogue(dlg);
    }
  }

  // Stable refs for rAF closure
  const triggerTransitionRef = useRef(triggerTransition);
  triggerTransitionRef.current = triggerTransition;
  const triggerSouthExitRef = useRef(triggerSouthExit);
  triggerSouthExitRef.current = triggerSouthExit;
  const tryStartDialogueRef = useRef(tryStartDialogue);
  tryStartDialogueRef.current = tryStartDialogue;

  // ── rAF game loop ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    function gameLoop(ts: number) {
      if (!ctx) return;

      // ── Movement ──
      let dx = 0;
      let dy = 0;
      if (!isTransitioningRef.current && !activeDialogueRef.current) {
        const keys = keysHeldRef.current;
        if (keys.has("ArrowUp")    || keys.has("w")) { dy -= MOVE_SPEED; playerDirRef.current = "up"; }
        if (keys.has("ArrowDown")  || keys.has("s")) { dy += MOVE_SPEED; playerDirRef.current = "down"; }
        if (keys.has("ArrowLeft")  || keys.has("a")) { dx -= MOVE_SPEED; playerDirRef.current = "left"; }
        if (keys.has("ArrowRight") || keys.has("d")) { dx += MOVE_SPEED; playerDirRef.current = "right"; }
      }

      const pos = pixelPosRef.current;
      const grid = roomGridRef.current;
      const grace = spawnGraceFramesRef.current > 0;
      if (grace) spawnGraceFramesRef.current--;

      const objs = placedObjectsRef.current;
      const candidateX = Math.max(0, Math.min(CANVAS_W - CHAR_SIZE, pos.x + dx));
      const newX = (!grace && (isBlocked(grid, candidateX, pos.y) || isBlockedByObject(objs, candidateX, pos.y))) ? pos.x : candidateX;
      const candidateY = Math.max(0, Math.min(CANVAS_H - CHAR_SIZE, pos.y + dy));
      const newY = (!grace && (isBlocked(grid, newX, candidateY) || isBlockedByObject(objs, newX, candidateY))) ? pos.y : candidateY;
      pixelPosRef.current = { x: newX, y: newY };

      // ── Animation ──
      const moving = dx !== 0 || dy !== 0;
      if (moving) {
        if (ts - lastAnimTickRef.current >= ANIM_INTERVAL) {
          playerFrameRef.current = (playerFrameRef.current + 1) % 4;
          lastAnimTickRef.current = ts;
        }
      } else {
        playerFrameRef.current = 0;
      }

      // ── Collision detection (play mode only) ──
      if (!isTransitioningRef.current && ts >= transitionCooldownRef.current && !isEditorModeRef.current) {
        const centerX = newX + CHAR_SIZE / 2;
        const centerY = newY + CHAR_SIZE / 2;
        const feetY   = newY + CHAR_SIZE;

        for (const pd of placedDoorsRef.current) {
          if (!pd.linkedRoomId) continue;
          const checkY = pd.wall === "north" ? feetY : centerY;
          const inBox =
            centerX >= pd.x && centerX <= pd.x + pd.width &&
            checkY  >= pd.y && checkY  <= pd.y + pd.height;
          if (!inBox) continue;
          const movingToward =
            (pd.wall === "north" && dy < 0) ||
            (pd.wall === "east"  && dx > 0) ||
            (pd.wall === "west"  && dx < 0);
          if (movingToward) {
            triggerTransitionRef.current(pd.linkedRoomId, pd.wall, pd);
            break;
          }
        }

        if (newY + CHAR_SIZE >= CANVAS_H && dy > 0 && previousRoomIdRef.current) {
          triggerSouthExitRef.current();
        }
      }

      // ── Draw background ──
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
      const bg = roomBgRef.current;
      if (bg) {
        ctx.drawImage(bg, 0, 0);
      } else {
        drawCheckerboard(ctx);
      }

      // ── Update mob states (play mode only) ──
      if (!isEditorModeRef.current && !isTransitioningRef.current) {
        for (const mob of placedMobsRef.current) {
          const state = mobStatesRef.current.get(mob.id);
          if (state) {
            mobStatesRef.current.set(mob.id, updateMobState(state, mob, ts));
          }
        }
        for (const npc of placedNPCsRef.current) {
          const state = npcStatesRef.current.get(npc.id);
          if (state) {
            npcStatesRef.current.set(npc.id, updateNPCState(state, npc, ts));
          }
        }
      }

      // ── Draw placed objects (after bg, before player) ──
      ctx.imageSmoothingEnabled = false;
      for (const po of placedObjectsRef.current) {
        const img = objectImgCacheRef.current.get(po.objectId);
        if (!img || !img.complete || img.naturalWidth === 0) continue;
        ctx.save();
        if (po.flippedH || po.flippedV) {
          ctx.translate(
            po.x + (po.flippedH ? po.width : 0),
            po.y + (po.flippedV ? po.height : 0),
          );
          ctx.scale(po.flippedH ? -1 : 1, po.flippedV ? -1 : 1);
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0, po.width, po.height);
        } else {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, po.x, po.y, po.width, po.height);
        }
        ctx.restore();
        // Editor outline + resize handle
        if (isEditorModeRef.current) {
          ctx.strokeStyle = "#3B82F6";
          ctx.lineWidth = 1;
          ctx.strokeRect(po.x, po.y, po.width, po.height);
          // Resize handle: 8x8 white square at bottom-right corner
          ctx.fillStyle = "#FFFFFF";
          ctx.fillRect(po.x + po.width - 8, po.y + po.height - 8, 8, 8);
          ctx.strokeStyle = "#374151";
          ctx.lineWidth = 1;
          ctx.strokeRect(po.x + po.width - 8, po.y + po.height - 8, 8, 8);
        }
      }

      // ── Draw mobs (after objects, before player) ──
      for (const mob of placedMobsRef.current) {
        let drawX = mob.x;
        let drawY = mob.y;
        let mobDir: Direction = "down";
        let mobFrame = 0;
        if (!isEditorModeRef.current) {
          const state = mobStatesRef.current.get(mob.id);
          if (state) { drawX = state.x; drawY = state.y; mobDir = state.dir; mobFrame = state.frame; }
        }
        const frames = mobFrameCacheRef.current.get(mob.mobId);
        const frameCanvas = frames?.[DIRECTION_TO_ROW[mobDir]]?.[mobFrame];
        if (frameCanvas) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(frameCanvas, drawX, drawY);
        } else {
          ctx.fillStyle = "#EF4444";
          ctx.fillRect(drawX + 8, drawY + 8, MOB_SIZE - 16, MOB_SIZE - 16);
        }
        if (isEditorModeRef.current) {
          const isSelected = selectedMobInstanceIdRef.current === mob.id;
          ctx.strokeStyle = isSelected ? "#FBBF24" : "#EF4444";
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeRect(mob.x, mob.y, MOB_SIZE, MOB_SIZE);
          // Draw patrol path
          if (mob.patrolPath.length > 0) {
            ctx.strokeStyle = "#FBBF24";
            ctx.fillStyle = "#FBBF24";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            mob.patrolPath.forEach((wp, i) => {
              if (i === 0) ctx.moveTo(wp.x, wp.y);
              else ctx.lineTo(wp.x, wp.y);
            });
            if (mob.patrolPath.length > 2) ctx.closePath();
            ctx.stroke();
            ctx.setLineDash([]);
            mob.patrolPath.forEach((wp) => {
              ctx.beginPath();
              ctx.arc(wp.x, wp.y, 4, 0, Math.PI * 2);
              ctx.fill();
            });
            // Highlight first waypoint as close target when editing
            if (editingMobPathIdRef.current === mob.id) {
              ctx.strokeStyle = "#10B981";
              ctx.lineWidth = 2;
              ctx.beginPath();
              ctx.arc(mob.patrolPath[0].x, mob.patrolPath[0].y, 7, 0, Math.PI * 2);
              ctx.stroke();
            }
          }
        }
      }

      // ── Draw NPCs (after mobs, before player) ──
      for (const npc of placedNPCsRef.current) {
        let drawX = npc.x;
        let drawY = npc.y;
        let npcDir: Direction = "down";
        let npcFrame = 0;
        if (!isEditorModeRef.current) {
          const state = npcStatesRef.current.get(npc.id);
          if (state) { drawX = state.x; drawY = state.y; npcDir = state.dir; npcFrame = state.frame; }
        }
        const frames = npcFrameCacheRef.current.get(npc.npcId);
        const frameCanvas = frames?.[DIRECTION_TO_ROW[npcDir]]?.[npcFrame];
        if (frameCanvas) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(frameCanvas, drawX, drawY);
        } else {
          ctx.fillStyle = "#10B981";
          ctx.fillRect(drawX + 8, drawY + 8, NPC_SIZE - 16, NPC_SIZE - 16);
        }
        if (isEditorModeRef.current) {
          const isSelected = selectedNPCInstanceIdRef.current === npc.id;
          ctx.strokeStyle = isSelected ? "#A78BFA" : "#10B981";
          ctx.lineWidth = isSelected ? 2 : 1;
          ctx.strokeRect(npc.x, npc.y, NPC_SIZE, NPC_SIZE);
        } else if (npc.dialogue.length > 0) {
          const state = npcStatesRef.current.get(npc.id);
          const npcCx = (state?.x ?? npc.x) + NPC_SIZE / 2;
          const npcCy = (state?.y ?? npc.y) + NPC_SIZE / 2;
          const playerCx = pixelPosRef.current.x + CHAR_SIZE / 2;
          const playerCy = pixelPosRef.current.y + CHAR_SIZE / 2;
          const dist = Math.sqrt((playerCx - npcCx) ** 2 + (playerCy - npcCy) ** 2);
          const inRange = dist < NPC_INTERACT_RANGE && !activeDialogueRef.current;
          const prevAlpha = npcPromptAlphaRef.current.get(npc.id) ?? 0;
          const newAlpha = prevAlpha + ((inRange ? 1 : 0) - prevAlpha) * 0.14;
          npcPromptAlphaRef.current.set(npc.id, newAlpha);
          if (newAlpha > 0.01) {
            const cx = Math.round(drawX + NPC_SIZE / 2);
            const headY = drawY;
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.globalAlpha = Math.min(1, newAlpha);
            // Measure text with Ahsing font
            ctx.font = "bold 9px 'Ahsing', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            const label = "TALK";
            const tw = ctx.measureText(label).width;
            const padX = 6;
            const padY = 3;
            const boxW = Math.ceil(tw) + padX * 2;
            const boxH = 16;
            const triH = 5;
            const triHalfW = 4;
            const boxX = Math.round(cx - boxW / 2);
            const boxY = Math.round(headY - boxH - triH - 6);
            const triTip = boxY + boxH + triH;
            // Outer shadow/depth (1px darker border offset)
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(boxX + 1, boxY + 1, boxW, boxH);
            // Box fill
            ctx.fillStyle = "#FAFAE8";
            ctx.fillRect(boxX, boxY, boxW, boxH);
            // Pixel border — draw each side as 1px line
            ctx.fillStyle = "#1a1a1a";
            ctx.fillRect(boxX, boxY, boxW, 1);             // top
            ctx.fillRect(boxX, boxY + boxH - 1, boxW, 1); // bottom
            ctx.fillRect(boxX, boxY, 1, boxH);             // left
            ctx.fillRect(boxX + boxW - 1, boxY, 1, boxH); // right
            // Triangle pointer
            ctx.fillStyle = "#FAFAE8";
            for (let ty = 0; ty < triH; ty++) {
              const halfW = Math.round(triHalfW * (1 - ty / triH));
              ctx.fillRect(cx - halfW, boxY + boxH + ty, halfW * 2, 1);
            }
            // Triangle outline (left + right edges only, 1px)
            ctx.fillStyle = "#1a1a1a";
            for (let ty = 0; ty < triH; ty++) {
              const halfW = Math.round(triHalfW * (1 - ty / triH));
              ctx.fillRect(cx - halfW, boxY + boxH + ty, 1, 1);
              ctx.fillRect(cx + halfW - 1, boxY + boxH + ty, 1, 1);
            }
            // Text
            ctx.fillStyle = "#1a1a1a";
            ctx.font = "bold 9px 'Ahsing', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(label, cx, boxY + Math.round(boxH / 2));
            void triTip; // suppress unused warning
            ctx.restore();
          }
        }
      }

      // ── Draw player sprite ──
      const { x, y } = pixelPosRef.current;
      const cacheKey = `${playerDirRef.current}:${playerFrameRef.current}`;
      const cachedFrame = charFrameCacheRef.current.get(cacheKey);
      if (cachedFrame) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(cachedFrame, x, y, CHAR_SIZE, CHAR_SIZE);
      } else {
        ctx.fillStyle = "#3B82F6";
        ctx.fillRect(x + 8, y + 8, CHAR_SIZE - 16, CHAR_SIZE - 16);
      }

      // ── Editor mode: door hitboxes ──
      if (isEditorModeRef.current) {
        ctx.save();
        for (const pd of placedDoorsRef.current) {
          const dragging = draggingDoorRef.current?.id === pd.id;
          ctx.fillStyle = dragging ? "rgba(59,130,246,0.5)" : "rgba(59,130,246,0.25)";
          ctx.strokeStyle = "#3B82F6";
          ctx.lineWidth = 2;
          ctx.shadowColor = "#3B82F6";
          ctx.shadowBlur = 8;
          ctx.fillRect(pd.x, pd.y, pd.width, pd.height);
          ctx.shadowBlur = 0;
          ctx.strokeRect(pd.x, pd.y, pd.width, pd.height);
          ctx.fillStyle = "#FFFFFF";
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "center";
          ctx.fillText(pd.wall[0].toUpperCase(), pd.x + pd.width / 2, pd.y + pd.height / 2 + 3);
          ctx.textAlign = "left";
        }
        ctx.restore();
      }

      // ── Fade overlay ──
      if (fadeRef.current.opacity > 0) {
        ctx.fillStyle = `rgba(0,0,0,${fadeRef.current.opacity})`;
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
      }

      rafIdRef.current = requestAnimationFrame(gameLoop);
    }

    rafIdRef.current = requestAnimationFrame(gameLoop);
    return () => cancelAnimationFrame(rafIdRef.current);
  }, []);

  // ── Key listeners ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const arrowKeys = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
      if (arrowKeys.has(e.key)) e.preventDefault();
      if (e.key === " ") {
        e.preventDefault();
        const dlg = activeDialogueRef.current;
        if (dlg !== null) {
          activeDialogueRef.current = null;
          setActiveDialogue(null);
          return;
        }
        if (!isEditorModeRef.current) {
          tryStartDialogueRef.current();
        }
        return;
      }
      if (e.key === "Escape" && editingMobPathIdRef.current) {
        setEditingMobPathId(null);
        editingMobPathIdRef.current = null;
        return;
      }
      keysHeldRef.current.add(e.key);
    }
    function handleKeyUp(e: KeyboardEvent) {
      keysHeldRef.current.delete(e.key);
    }
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleRoomClick(room: SidebarRoom) {
    if (isTransitioningRef.current) return;
    previousRoomIdRef.current = null;
    currentRoomIdRef.current = room.id;
    roomGridRef.current = room.grid.length > 0 ? room.grid : null;
    placedDoorsRef.current = room.placedDoors ?? [];
    setPlacedDoors(room.placedDoors ?? []);
    const roomObjects = room.placedObjects ?? [];
    placedObjectsRef.current = roomObjects;
    setPlacedObjects(roomObjects);
    preloadPlacedObjectImages(roomObjects);
    const roomMobs = room.placedMobs ?? [];
    placedMobsRef.current = roomMobs;
    setPlacedMobs(roomMobs);
    const roomNPCs = room.placedNPCs ?? [];
    placedNPCsRef.current = roomNPCs;
    setPlacedNPCs(roomNPCs);
    if (!room.imageBase64) {
      roomBgRef.current = null;
      return;
    }
    const cached = roomBgCacheRef.current.get(room.id);
    if (cached) {
      roomBgRef.current = cached;
    } else {
      decodeRoomImage(room.imageBase64)
        .then((off) => {
          roomBgCacheRef.current.set(room.id, off);
          roomBgRef.current = off;
        })
        .catch(() => console.warn("Room image failed:", room.name));
    }
  }

  function handleToggleEditorMode() {
    const next = !isEditorMode;
    setIsEditorMode(next);
    isEditorModeRef.current = next;
    if (!next) {
      setEditorTool(null);
      setSelectedObjectId(null);
      setSelectedMobSourceId(null);
      setSelectedMobInstanceId(null);
      setEditingMobPathId(null);
      setSelectedNPCSourceId(null);
      setSelectedNPCInstanceId(null);
      setPendingDoor(null);
      editorToolRef.current = null;
      selectedObjectRef.current = null;
      selectedMobSourceRef.current = null;
      selectedMobInstanceIdRef.current = null;
      editingMobPathIdRef.current = null;
      selectedNPCSourceRef.current = null;
      selectedNPCInstanceIdRef.current = null;
      draggingDoorRef.current = null;
      draggingObjectRef.current = null;
      draggingMobRef.current = null;
      draggingNPCRef.current = null;
      resizingObjectRef.current = null;
    }
  }

  // Canvas mouse events

  function handleCanvasMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    console.log("canvas click, isEditorMode:", isEditorModeRef.current, "editorTool:", editorToolRef.current, "selectedObject:", selectedObjectRef.current?.id);
    if (!isEditorModeRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cx, cy } = getCanvasCoords(e, canvas);

    // Check resize handles first — takes priority over any tool
    for (const po of [...placedObjectsRef.current].reverse()) {
      const hx = po.x + po.width - 8;
      const hy = po.y + po.height - 8;
      if (cx >= hx && cx <= hx + 8 && cy >= hy && cy <= hy + 8) {
        resizingObjectRef.current = { id: po.id, startMouseX: cx, startMouseY: cy, startW: po.width, startH: po.height };
        return;
      }
    }

    // Path editing mode — add waypoint (highest priority after resize)
    if (editingMobPathIdRef.current) {
      const mobId = editingMobPathIdRef.current;
      const targetMob = placedMobsRef.current.find((m) => m.id === mobId);
      if (targetMob) {
        let closed = false;
        if (targetMob.patrolPath.length >= 3) {
          const first = targetMob.patrolPath[0];
          const dist = Math.sqrt((cx - first.x) ** 2 + (cy - first.y) ** 2);
          if (dist <= 16) {
            setEditingMobPathId(null);
            editingMobPathIdRef.current = null;
            closed = true;
          }
        }
        if (!closed) {
          const newPath = [...targetMob.patrolPath, { x: Math.round(cx), y: Math.round(cy) }];
          void handleUpdateMobPath(mobId, newPath);
        }
      }
      return;
    }

    if (editorToolRef.current === "door") {
      if (pendingDoor || !currentRoomIdRef.current) return;
      for (const pd of placedDoorsRef.current) {
        if (cx >= pd.x && cx <= pd.x + pd.width && cy >= pd.y && cy <= pd.y + pd.height) {
          draggingDoorRef.current = { id: pd.id, offsetX: cx - pd.x, offsetY: cy - pd.y };
          return;
        }
      }
      setPendingDoor({ x: Math.round(cx - DOOR_W / 2), y: Math.round(cy - DOOR_H / 2) });
      return;
    }

    if (editorToolRef.current === "object") {
      if (!currentRoomIdRef.current) return;
      // Check existing placed objects (reversed = topmost first)
      const objects = [...placedObjectsRef.current].reverse();
      for (const po of objects) {
        if (cx >= po.x && cx <= po.x + po.width && cy >= po.y && cy <= po.y + po.height) {
          draggingObjectRef.current = { id: po.id, offsetX: cx - po.x, offsetY: cy - po.y };
          return;
        }
      }
      // Place new object
      const src = selectedObjectRef.current;
      if (!src) return;
      const newObj: PlacedObject = {
        id: Date.now().toString(),
        objectId: src.id,
        imageBase64: src.imageBase64,
        x: Math.max(0, Math.min(CANVAS_W - OBJ_SIZE, Math.round(cx - OBJ_SIZE / 2))),
        y: Math.max(0, Math.min(CANVAS_H - OBJ_SIZE, Math.round(cy - OBJ_SIZE / 2))),
        width: OBJ_SIZE,
        height: OBJ_SIZE,
        flippedH: false,
        flippedV: false,
      };
      if (!objectImgCacheRef.current.has(src.id) && src.imageBase64) {
        const img = new Image();
        img.src = src.imageBase64;
        objectImgCacheRef.current.set(src.id, img);
      }
      const newObjects = [...placedObjectsRef.current, newObj];
      setPlacedObjects(newObjects);
      setSavedRooms((prev) =>
        prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedObjects: newObjects } : r)
      );
      const db = getFirebaseDb();
      updateDoc(
        doc(db, "users", user!.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
        { placedObjects: newObjects }
      ).catch((err) => console.warn("Failed to save placed object:", err));
    }

    if (editorToolRef.current === "mob") {
      if (!currentRoomIdRef.current) return;
      // Check existing placed mobs (reversed = topmost first)
      const mobs = [...placedMobsRef.current].reverse();
      for (const mob of mobs) {
        if (cx >= mob.x && cx <= mob.x + MOB_SIZE && cy >= mob.y && cy <= mob.y + MOB_SIZE) {
          setSelectedMobInstanceId(mob.id);
          selectedMobInstanceIdRef.current = mob.id;
          draggingMobRef.current = { id: mob.id, offsetX: cx - mob.x, offsetY: cy - mob.y };
          return;
        }
      }
      // Place new mob
      const src = selectedMobSourceRef.current;
      if (!src) return;
      const newMob: PlacedMob = {
        id: Date.now().toString(),
        mobId: src.id,
        spritesheet: src.spritesheet,
        x: Math.max(0, Math.min(CANVAS_W - MOB_SIZE, Math.round(cx - MOB_SIZE / 2))),
        y: Math.max(0, Math.min(CANVAS_H - MOB_SIZE, Math.round(cy - MOB_SIZE / 2))),
        patrolPath: [],
      };
      if (!mobFrameCacheRef.current.has(src.id) && src.spritesheet) {
        parseMobSpritesheet(src.spritesheet)
          .then((frames) => mobFrameCacheRef.current.set(src.id, frames))
          .catch(() => {});
      }
      const newMobs = [...placedMobsRef.current, newMob];
      setPlacedMobs(newMobs);
      setSavedRooms((prev) =>
        prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedMobs: newMobs } : r)
      );
      const db = getFirebaseDb();
      updateDoc(
        doc(db, "users", user!.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
        { placedMobs: newMobs }
      ).catch((err) => console.warn("Failed to save placed mob:", err));
    }

    if (editorToolRef.current === "npc") {
      if (!currentRoomIdRef.current) return;
      const npcs = [...placedNPCsRef.current].reverse();
      for (const npc of npcs) {
        if (cx >= npc.x && cx <= npc.x + NPC_SIZE && cy >= npc.y && cy <= npc.y + NPC_SIZE) {
          setSelectedNPCInstanceId(npc.id);
          selectedNPCInstanceIdRef.current = npc.id;
          draggingNPCRef.current = { id: npc.id, offsetX: cx - npc.x, offsetY: cy - npc.y };
          return;
        }
      }
      const src = selectedNPCSourceRef.current;
      if (!src) return;
      const newNPC: PlacedNPC = {
        id: Date.now().toString(),
        npcId: src.id,
        spritesheet: src.spritesheet,
        isWalking: src.isWalking,
        dialogue: src.dialogue,
        dialogueStyle: src.dialogueStyle,
        name: src.name,
        x: Math.max(0, Math.min(CANVAS_W - NPC_SIZE, Math.round(cx - NPC_SIZE / 2))),
        y: Math.max(0, Math.min(CANVAS_H - NPC_SIZE, Math.round(cy - NPC_SIZE / 2))),
      };
      if (!npcFrameCacheRef.current.has(src.id) && src.spritesheet) {
        parseMobSpritesheet(src.spritesheet)
          .then((frames) => npcFrameCacheRef.current.set(src.id, frames))
          .catch(() => {});
      }
      const newNPCs = [...placedNPCsRef.current, newNPC];
      setPlacedNPCs(newNPCs);
      setSavedRooms((prev) =>
        prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedNPCs: newNPCs } : r)
      );
      const db = getFirebaseDb();
      updateDoc(
        doc(db, "users", user!.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
        { placedNPCs: newNPCs }
      ).catch((err) => console.warn("Failed to save placed NPC:", err));
    }
  }

  function handleCanvasMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cx, cy } = getCanvasCoords(e, canvas);

    if (resizingObjectRef.current) {
      const r = resizingObjectRef.current;
      const newW = Math.max(32, Math.min(256, Math.round(r.startW + cx - r.startMouseX)));
      const newH = Math.max(32, Math.min(256, Math.round(r.startH + cy - r.startMouseY)));
      setPlacedObjects((prev) =>
        prev.map((po) => po.id === r.id ? { ...po, width: newW, height: newH } : po)
      );
      return;
    }

    if (draggingDoorRef.current) {
      const drag = draggingDoorRef.current;
      const newX = Math.round(Math.max(0, Math.min(CANVAS_W - DOOR_W, cx - drag.offsetX)));
      const newY = Math.round(Math.max(0, Math.min(CANVAS_H - DOOR_H, cy - drag.offsetY)));
      setPlacedDoors((prev) =>
        prev.map((pd) => pd.id === drag.id ? { ...pd, x: newX, y: newY } : pd)
      );
      return;
    }

    if (draggingObjectRef.current) {
      const drag = draggingObjectRef.current;
      const newX = Math.round(Math.max(0, Math.min(CANVAS_W - OBJ_SIZE, cx - drag.offsetX)));
      const newY = Math.round(Math.max(0, Math.min(CANVAS_H - OBJ_SIZE, cy - drag.offsetY)));
      setPlacedObjects((prev) =>
        prev.map((po) => po.id === drag.id ? { ...po, x: newX, y: newY } : po)
      );
    }

    if (draggingMobRef.current) {
      const drag = draggingMobRef.current;
      const newX = Math.round(Math.max(0, Math.min(CANVAS_W - MOB_SIZE, cx - drag.offsetX)));
      const newY = Math.round(Math.max(0, Math.min(CANVAS_H - MOB_SIZE, cy - drag.offsetY)));
      setPlacedMobs((prev) =>
        prev.map((m) => m.id === drag.id ? { ...m, x: newX, y: newY } : m)
      );
    }

    if (draggingNPCRef.current) {
      const drag = draggingNPCRef.current;
      const newX = Math.round(Math.max(0, Math.min(CANVAS_W - NPC_SIZE, cx - drag.offsetX)));
      const newY = Math.round(Math.max(0, Math.min(CANVAS_H - NPC_SIZE, cy - drag.offsetY)));
      setPlacedNPCs((prev) =>
        prev.map((n) => n.id === drag.id ? { ...n, x: newX, y: newY } : n)
      );
    }
  }

  async function handleCanvasMouseUp() {
    if (resizingObjectRef.current) {
      resizingObjectRef.current = null;
      if (!user || !currentRoomIdRef.current) return;
      const updatedObjects = placedObjectsRef.current;
      setSavedRooms((prev) =>
        prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedObjects: updatedObjects } : r)
      );
      const db = getFirebaseDb();
      await updateDoc(
        doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
        { placedObjects: updatedObjects }
      ).catch((err) => console.warn("Failed to save resized object:", err));
      return;
    }

    if (draggingDoorRef.current) {
      draggingDoorRef.current = null;
      if (!user || !currentRoomIdRef.current) return;
      const updatedDoors = placedDoorsRef.current;
      setSavedRooms((prev) =>
        prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedDoors: updatedDoors } : r)
      );
      const db = getFirebaseDb();
      await updateDoc(
        doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
        { placedDoors: updatedDoors }
      ).catch((err) => console.warn("Failed to save door positions:", err));
      return;
    }

    if (draggingObjectRef.current) {
      draggingObjectRef.current = null;
      if (!user || !currentRoomIdRef.current) return;
      const updatedObjects = placedObjectsRef.current;
      setSavedRooms((prev) =>
        prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedObjects: updatedObjects } : r)
      );
      const db = getFirebaseDb();
      await updateDoc(
        doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
        { placedObjects: updatedObjects }
      ).catch((err) => console.warn("Failed to save object positions:", err));
    }

    if (draggingMobRef.current) {
      draggingMobRef.current = null;
      if (!user || !currentRoomIdRef.current) return;
      const updatedMobs = placedMobsRef.current;
      setSavedRooms((prev) =>
        prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedMobs: updatedMobs } : r)
      );
      const db = getFirebaseDb();
      await updateDoc(
        doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
        { placedMobs: updatedMobs }
      ).catch((err) => console.warn("Failed to save mob positions:", err));
    }

    if (draggingNPCRef.current) {
      draggingNPCRef.current = null;
      if (!user || !currentRoomIdRef.current) return;
      const updatedNPCs = placedNPCsRef.current;
      setSavedRooms((prev) =>
        prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedNPCs: updatedNPCs } : r)
      );
      const db = getFirebaseDb();
      await updateDoc(
        doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
        { placedNPCs: updatedNPCs }
      ).catch((err) => console.warn("Failed to save NPC positions:", err));
    }
  }

  function handleCanvasContextMenu(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!isEditorModeRef.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { cx, cy } = getCanvasCoords(e, canvas);
    // Check NPCs first
    const npcsCtx = [...placedNPCsRef.current].reverse();
    for (const npc of npcsCtx) {
      if (cx >= npc.x && cx <= npc.x + NPC_SIZE && cy >= npc.y && cy <= npc.y + NPC_SIZE) {
        void handleDeletePlacedNPC(npc.id);
        return;
      }
    }
    // Check mobs next
    const mobs = [...placedMobsRef.current].reverse();
    for (const mob of mobs) {
      if (cx >= mob.x && cx <= mob.x + MOB_SIZE && cy >= mob.y && cy <= mob.y + MOB_SIZE) {
        void handleDeletePlacedMob(mob.id);
        return;
      }
    }
    // Find topmost placed object at this position
    const objects = [...placedObjectsRef.current].reverse();
    for (const po of objects) {
      if (cx >= po.x && cx <= po.x + po.width && cy >= po.y && cy <= po.y + po.height) {
        void handleDeletePlacedObject(po.id);
        return;
      }
    }
  }

  async function handleDeletePlacedObject(objId: string) {
    if (!user || !currentRoomIdRef.current) return;
    const newObjects = placedObjectsRef.current.filter((po) => po.id !== objId);
    setPlacedObjects(newObjects);
    setSavedRooms((prev) =>
      prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedObjects: newObjects } : r)
    );
    const db = getFirebaseDb();
    await updateDoc(
      doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
      { placedObjects: newObjects }
    ).catch((err) => console.warn("Failed to delete placed object:", err));
  }

  async function handleSavePlacedDoor(
    wall: PlacedDoor["wall"],
    linkedRoomId: string,
    pos: { x: number; y: number },
  ) {
    if (!user || !currentRoomIdRef.current) return;
    const newDoor: PlacedDoor = {
      id: Date.now().toString(),
      x: pos.x,
      y: pos.y,
      width: DOOR_W,
      height: DOOR_H,
      wall,
      linkedRoomId,
    };
    const newDoors = [...placedDoorsRef.current, newDoor];
    setPlacedDoors(newDoors);
    setSavedRooms((prev) =>
      prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedDoors: newDoors } : r)
    );
    setPendingDoor(null);
    const db = getFirebaseDb();
    await updateDoc(
      doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
      { placedDoors: newDoors }
    ).catch((err) => console.warn("Failed to save placed door:", err));
  }

  async function handleDeletePlacedDoor(doorId: string) {
    if (!user || !currentRoomIdRef.current) return;
    const newDoors = placedDoorsRef.current.filter((d) => d.id !== doorId);
    setPlacedDoors(newDoors);
    setSavedRooms((prev) =>
      prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedDoors: newDoors } : r)
    );
    const db = getFirebaseDb();
    await updateDoc(
      doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
      { placedDoors: newDoors }
    ).catch((err) => console.warn("Failed to delete placed door:", err));
  }

  async function handleDeletePlacedMob(mobId: string) {
    if (!user || !currentRoomIdRef.current) return;
    const newMobs = placedMobsRef.current.filter((m) => m.id !== mobId);
    setPlacedMobs(newMobs);
    if (selectedMobInstanceIdRef.current === mobId) {
      setSelectedMobInstanceId(null);
      selectedMobInstanceIdRef.current = null;
    }
    setSavedRooms((prev) =>
      prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedMobs: newMobs } : r)
    );
    const db = getFirebaseDb();
    await updateDoc(
      doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
      { placedMobs: newMobs }
    ).catch((err) => console.warn("Failed to delete placed mob:", err));
  }

  async function handleDeletePlacedNPC(npcId: string) {
    if (!user || !currentRoomIdRef.current) return;
    const newNPCs = placedNPCsRef.current.filter((n) => n.id !== npcId);
    setPlacedNPCs(newNPCs);
    if (selectedNPCInstanceIdRef.current === npcId) {
      setSelectedNPCInstanceId(null);
      selectedNPCInstanceIdRef.current = null;
    }
    setSavedRooms((prev) =>
      prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedNPCs: newNPCs } : r)
    );
    const db = getFirebaseDb();
    await updateDoc(
      doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
      { placedNPCs: newNPCs }
    ).catch((err) => console.warn("Failed to delete placed NPC:", err));
  }

  async function handleUpdateMobPath(mobId: string, newPath: { x: number; y: number }[]) {
    if (!user || !currentRoomIdRef.current) return;
    const newMobs = placedMobsRef.current.map((m) =>
      m.id === mobId ? { ...m, patrolPath: newPath } : m
    );
    setPlacedMobs(newMobs);
    setSavedRooms((prev) =>
      prev.map((r) => r.id === currentRoomIdRef.current ? { ...r, placedMobs: newMobs } : r)
    );
    const db = getFirebaseDb();
    await updateDoc(
      doc(db, "users", user.uid, "projects", projectId, "rooms", currentRoomIdRef.current),
      { placedMobs: newMobs }
    ).catch((err) => console.warn("Failed to save mob path:", err));
  }

  function toggleTab(tab: SidebarTab) {
    setActiveTab((prev) => (prev === tab ? null : tab));
  }

  // ── Loading guard ─────────────────────────────────────────────────────────────

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  // ── Cursor style ──────────────────────────────────────────────────────────────

  const canvasCursor =
    isEditorMode && editorTool !== null ? "crosshair" : "default";

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-screen bg-gray-900">
      {/* ── Sidebar ──────────────────────────────────────────────────────────── */}
      <aside className="flex w-56 shrink-0 flex-col border-r border-gray-700 bg-gray-800">
        <div className="border-b border-gray-700 px-4 py-3">
          <p className="truncate text-sm text-gray-300 font-ahsing">
            {projectName ?? "Project"}
          </p>
          <p className="mt-0.5 text-sm font-bold text-white">Test Area</p>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Rooms tab */}
          <TabSection label="Rooms" count={savedRooms.length} open={activeTab === "rooms"} onToggle={() => toggleTab("rooms")}>
            {savedRooms.length === 0 ? (
              <p className="px-4 py-2 text-xs text-gray-500">No rooms saved</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {savedRooms.map((room) => (
                  <button
                    key={room.id}
                    onClick={() => handleRoomClick(room)}
                    className="group flex flex-col items-center gap-1 rounded p-1 hover:bg-gray-700"
                  >
                    <div className="h-[54px] w-[80px] overflow-hidden rounded border border-gray-600 bg-gray-700">
                      {room.imageBase64 ? (
                        <img src={room.imageBase64} alt={room.name} className="h-full w-full object-cover" style={{ imageRendering: "pixelated" }} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="text-xs text-gray-500">No img</span>
                        </div>
                      )}
                    </div>
                    <span className="max-w-[80px] truncate text-xs text-gray-300 group-hover:text-white font-ahsing">{room.name}</span>
                  </button>
                ))}
              </div>
            )}
          </TabSection>

          {/* Characters tab */}
          <TabSection label="Characters" count={characters.length} open={activeTab === "characters"} onToggle={() => toggleTab("characters")}>
            {characters.length === 0 ? (
              <p className="px-4 py-2 text-xs text-gray-500">No characters saved</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {characters.map((char) => (
                  <button
                    key={char.id}
                    onClick={() => setSelectedCharId(char.id)}
                    className={`flex flex-col items-center gap-1 rounded p-1 transition-all ${
                      selectedCharId === char.id ? "bg-blue-900/60 ring-1 ring-blue-400" : "hover:bg-gray-700"
                    }`}
                  >
                    <div className="h-10 w-10 overflow-hidden rounded bg-gray-700">
                      {charThumbs[char.id] ? (
                        <img src={charThumbs[char.id]} alt={char.name} className="h-full w-full" style={{ imageRendering: "pixelated" }} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gray-600 text-sm font-bold text-white">
                          {char.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <span className="max-w-[56px] truncate text-xs text-gray-300 font-ahsing">{char.name}</span>
                  </button>
                ))}
              </div>
            )}
          </TabSection>

          {/* Accessories tab */}
          <TabSection label="Accessories" count={savedAccessories.length} open={activeTab === "accessories"} onToggle={() => toggleTab("accessories")}>
            {savedAccessories.length === 0 ? (
              <p className="px-4 py-2 text-xs text-gray-500">No accessories saved</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {savedAccessories.map((acc) => (
                  <div key={acc.id} className="flex flex-col items-center gap-1 rounded p-1">
                    <div className="h-10 w-10 overflow-hidden rounded border border-gray-600 bg-gray-700">
                      {acc.thumbUrl ? (
                        <img src={acc.thumbUrl} alt={acc.name} className="h-full w-full object-cover" style={{ imageRendering: "pixelated" }} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="text-[9px] text-gray-500">?</span>
                        </div>
                      )}
                    </div>
                    <span className="max-w-[56px] truncate text-[10px] text-gray-300">{acc.name}</span>
                    {acc.type && <span className="text-[9px] text-gray-500">{acc.type}</span>}
                  </div>
                ))}
              </div>
            )}
          </TabSection>

          {/* Objects tab */}
          <TabSection label="Objects" count={savedObjects.length} open={activeTab === "objects"} onToggle={() => toggleTab("objects")}>
            {savedObjects.length === 0 ? (
              <p className="px-4 py-2 text-xs text-gray-500">No objects saved</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {savedObjects.map((obj) => (
                  <button
                    key={obj.id}
                    onClick={() => {
                      const isSelected = selectedObjectId === obj.id;
                      const nextId = isSelected ? null : obj.id;
                      const nextTool: "object" | null = isSelected ? null : "object";
                      setSelectedObjectId(nextId);
                      setEditorTool(nextTool);
                      // Write to refs immediately so canvas handler sees them before next render
                      selectedObjectRef.current = isSelected ? null : obj;
                      editorToolRef.current = nextTool;
                      // Clear mob selection
                      setSelectedMobSourceId(null);
                      selectedMobSourceRef.current = null;
                    }}
                    className={`flex flex-col items-center gap-1 rounded p-1 transition-all ${
                      selectedObjectId === obj.id
                        ? "bg-blue-900/60 ring-1 ring-blue-400"
                        : "hover:bg-gray-700"
                    }`}
                  >
                    <div className="h-10 w-10 overflow-hidden rounded border border-gray-600 bg-gray-700">
                      {obj.imageBase64 ? (
                        <img src={obj.imageBase64} alt={obj.name} className="h-full w-full object-cover" style={{ imageRendering: "pixelated" }} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <span className="text-[9px] text-gray-500">?</span>
                        </div>
                      )}
                    </div>
                    <span className="max-w-[56px] truncate text-[10px] text-gray-300">{obj.name}</span>
                  </button>
                ))}
              </div>
            )}
          </TabSection>

          {/* Mobs tab */}
          <TabSection label="Mobs" count={savedMobs.length} open={activeTab === "mobs"} onToggle={() => toggleTab("mobs")}>
            {savedMobs.length === 0 ? (
              <p className="px-4 py-2 text-xs text-gray-500">No mobs saved</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {savedMobs.map((mob) => (
                  <button
                    key={mob.id}
                    onClick={() => {
                      const isSelected = selectedMobSourceId === mob.id;
                      const nextId = isSelected ? null : mob.id;
                      const nextTool: "mob" | null = isSelected ? null : "mob";
                      setSelectedMobSourceId(nextId);
                      setEditorTool(nextTool);
                      selectedMobSourceRef.current = isSelected ? null : mob;
                      editorToolRef.current = nextTool;
                      // Clear object selection
                      setSelectedObjectId(null);
                      selectedObjectRef.current = null;
                    }}
                    className={`flex flex-col items-center gap-1 rounded p-1 transition-all ${
                      selectedMobSourceId === mob.id
                        ? "bg-red-900/60 ring-1 ring-red-400"
                        : "hover:bg-gray-700"
                    }`}
                  >
                    <MobThumb spritesheet={mob.spritesheet} />
                    <span className="max-w-[56px] truncate text-[10px] text-gray-300">{mob.name}</span>
                  </button>
                ))}
              </div>
            )}
          </TabSection>

          {/* NPCs tab */}
          <TabSection label="NPCs" count={savedNPCs.length} open={activeTab === "npcs"} onToggle={() => toggleTab("npcs")}>
            {savedNPCs.length === 0 ? (
              <p className="px-4 py-2 text-xs text-gray-500">No NPCs saved</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 p-3">
                {savedNPCs.map((npc) => (
                  <button
                    key={npc.id}
                    onClick={() => {
                      const isSelected = selectedNPCSourceId === npc.id;
                      const nextId = isSelected ? null : npc.id;
                      const nextTool: "npc" | null = isSelected ? null : "npc";
                      setSelectedNPCSourceId(nextId);
                      setEditorTool(nextTool);
                      selectedNPCSourceRef.current = isSelected ? null : npc;
                      editorToolRef.current = nextTool;
                      setSelectedMobSourceId(null);
                      selectedMobSourceRef.current = null;
                      setSelectedObjectId(null);
                      selectedObjectRef.current = null;
                    }}
                    className={`flex flex-col items-center gap-1 rounded p-1 transition-all ${
                      selectedNPCSourceId === npc.id
                        ? "bg-violet-900/60 ring-1 ring-violet-400"
                        : "hover:bg-gray-700"
                    }`}
                  >
                    <MobThumb spritesheet={npc.spritesheet} />
                    <span className="max-w-[56px] truncate text-[10px] text-gray-300">{npc.name}</span>
                    <span className="text-[9px] text-gray-500">{npc.isWalking ? "Walk" : "Idle"}</span>
                  </button>
                ))}
              </div>
            )}
          </TabSection>

          {/* Room Editor tab */}
          <TabSection label="Room Editor" count={placedDoors.length} open={activeTab === "editor"} onToggle={() => toggleTab("editor")}>
            <div className="space-y-2 p-3">
              <button
                onClick={() => setEditorTool((t) => (t === "door" ? null : "door"))}
                disabled={!isEditorMode}
                className={`w-full rounded px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  editorTool === "door"
                    ? "bg-blue-600 text-white"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                }`}
              >
                Door Tool
              </button>
              <button
                disabled
                className="w-full cursor-not-allowed rounded bg-gray-700 px-3 py-2 text-xs text-gray-500 opacity-40"
              >
                Border Tool (coming soon)
              </button>

              {placedDoors.length > 0 && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Placed Doors</p>
                  {placedDoors.map((pd) => (
                    <div key={pd.id} className="flex items-center justify-between rounded bg-gray-700/50 px-2 py-1">
                      <span className="text-[10px] text-gray-300">
                        {pd.wall}{pd.linkedRoomId ? " → linked" : " (unlinked)"}
                      </span>
                      <button
                        onClick={() => handleDeletePlacedDoor(pd.id)}
                        className="text-[10px] text-red-400 hover:text-red-300"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TabSection>
        </div>

        <div className="border-t border-gray-700 p-3">
          <button
            onClick={() => router.push(`/project-hub/${projectId}`)}
            className="w-full rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white"
          >
            ← Back to Hub
          </button>
        </div>
      </aside>

      {/* ── Main canvas area ─────────────────────────────────────────────────── */}
      <main
        className={
          isFullscreen
            ? "fixed inset-0 z-50 flex items-center justify-center bg-black"
            : "flex flex-1 flex-col items-center justify-center overflow-hidden p-4"
        }
      >
        {/* Editor / Play toggle */}
        {!isFullscreen && (
          <div className="mb-2 flex items-center gap-3">
            <button
              onClick={handleToggleEditorMode}
              className={`rounded px-4 py-1 text-xs font-semibold transition-colors ${
                isEditorMode
                  ? "bg-yellow-500 text-gray-900 hover:bg-yellow-400"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600"
              }`}
            >
              {isEditorMode ? "Editor Mode" : "Play Mode"}
            </button>

            {isEditorMode && (
              <span className="text-[10px] text-gray-500">
                {editingMobPathId
                  ? "Click to add waypoints — click first point to close loop — Esc to finish"
                  : editorTool === "door"
                  ? "Click canvas to place a door — drag to reposition"
                  : editorTool === "object"
                  ? "Click to place — drag to reposition — right-click to delete"
                  : editorTool === "mob"
                  ? "Click to place mob — drag to reposition — right-click to delete"
                  : editorTool === "npc"
                  ? "Click to place NPC — drag to reposition — right-click to delete"
                  : "Select a tool from Room Editor or click an object/mob/NPC"}
              </span>
            )}
          </div>
        )}

        <div
          className="relative"
          style={{
            width: isFullscreen
              ? "min(100vw, calc(100vh * 3 / 2))"
              : "min(100%, calc(100% * 3 / 2), calc((100vh - 6rem) * 3 / 2))",
            aspectRatio: "3 / 2",
          }}
        >
          <canvas
            ref={canvasRef}
            width={CANVAS_W}
            height={CANVAS_H}
            onMouseDown={handleCanvasMouseDown}
            onMouseMove={handleCanvasMouseMove}
            onMouseUp={handleCanvasMouseUp}
            onContextMenu={handleCanvasContextMenu}
            className="block h-full w-full border-2 border-gray-700"
            style={{
              imageRendering: "pixelated",
              cursor: canvasCursor,
              ...(isFullscreen ? { border: "none" } : {}),
            }}
          />

          {/* Pending door configure popup */}
          {pendingDoor && (
            <PendingDoorConfig
              pos={pendingDoor}
              rooms={savedRooms}
              currentRoomId={currentRoomIdRef.current}
              onSave={(wall, linkedRoomId) => handleSavePlacedDoor(wall, linkedRoomId, pendingDoor)}
              onCancel={() => setPendingDoor(null)}
            />
          )}

          {/* Edit Patrol Path button — shown when a mob instance is selected */}
          {isEditorMode && selectedMobInstanceId && (
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-2">
              <button
                onClick={() => {
                  if (editingMobPathId === selectedMobInstanceId) {
                    setEditingMobPathId(null);
                    editingMobPathIdRef.current = null;
                  } else {
                    setEditingMobPathId(selectedMobInstanceId);
                    editingMobPathIdRef.current = selectedMobInstanceId;
                  }
                }}
                className={`rounded-lg px-3 py-1 text-xs font-semibold shadow-lg transition-colors ${
                  editingMobPathId === selectedMobInstanceId
                    ? "bg-yellow-500 text-gray-900 hover:bg-yellow-400"
                    : "bg-gray-800/90 text-white hover:bg-gray-700"
                }`}
              >
                {editingMobPathId === selectedMobInstanceId ? "Done (Esc)" : "Edit Path"}
              </button>
              <button
                onClick={() => void handleUpdateMobPath(selectedMobInstanceId, [])}
                className="rounded-lg bg-gray-800/90 px-3 py-1 text-xs text-gray-300 hover:bg-gray-700 shadow-lg"
              >
                Clear Path
              </button>
            </div>
          )}

          {/* Dialogue box overlay */}
          {activeDialogue && !isEditorMode && (
            <DialogueBox dialogue={activeDialogue} />
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen((f) => !f)}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded bg-black/50 text-white opacity-60 hover:opacity-100"
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
            )}
          </button>
        </div>
      </main>
    </div>
  );
}

// ─── TabSection ───────────────────────────────────────────────────────────────

function TabSection({
  label, count, open, onToggle, children,
}: {
  label: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-gray-700">
      <button
        onClick={onToggle}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 hover:bg-gray-700/50 hover:text-gray-200"
      >
        <span>{label}</span>
        <span className="flex items-center gap-2">
          <span className="rounded-full bg-gray-700 px-1.5 py-0.5 text-[10px] text-gray-400">{count}</span>
          <span className="text-[10px]">{open ? "▲" : "▼"}</span>
        </span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

// ─── MobThumb ─────────────────────────────────────────────────────────────────

function MobThumb({ spritesheet }: { spritesheet: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const lastTickRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !spritesheet) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => { imgRef.current = img; };
    img.src = spritesheet;

    function animate(ts: number) {
      if (!ctx || !canvas) return;
      if (ts - lastTickRef.current >= 200) {
        frameRef.current = (frameRef.current + 1) % 4;
        lastTickRef.current = ts;
      }
      ctx.clearRect(0, 0, 40, 40);
      const sheet = imgRef.current;
      if (sheet && sheet.complete && sheet.naturalWidth > 0) {
        const fw = sheet.width / 4;
        const fh = sheet.height / 4;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sheet, frameRef.current * fw, 2 * fh, fw, fh, 0, 0, 40, 40);
      }
      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spritesheet]);

  return (
    <canvas
      ref={canvasRef}
      width={40}
      height={40}
      className="rounded border border-gray-600 bg-gray-700"
      style={{ imageRendering: "pixelated", width: 40, height: 40 }}
    />
  );
}

// ─── DialogueBox ──────────────────────────────────────────────────────────────

function DialogueBox({ dialogue }: { dialogue: DialogueState }) {
  const { npcName, lines, style } = dialogue;
  const text = lines[0] ?? "";
  const hint = "Space ✕";

  if (style === "rpg_banner") return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 border-t-2 border-yellow-700 bg-black/95">
      <div className="flex items-center gap-3 px-5 py-3">
        <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded border border-gray-600 bg-gray-800 text-lg font-ahsing text-gray-300">
          {npcName.charAt(0)}
        </div>
        <div className="flex-1">
          <p className="mb-1 font-ahsing text-xs text-yellow-400">{npcName}</p>
          <p className="text-sm leading-snug text-white">{text}</p>
        </div>
        <span className="text-[10px] text-gray-500">{hint}</span>
      </div>
    </div>
  );

  if (style === "speech_bubble") return (
    <div className="pointer-events-none absolute bottom-10 left-1/2 -translate-x-1/2">
      <div className="relative rounded-2xl border-2 border-gray-200 bg-white px-5 py-3 shadow-xl" style={{ minWidth: 200, maxWidth: 320 }}>
        <p className="mb-1 font-ahsing text-xs text-blue-600">{npcName}</p>
        <p className="text-sm text-gray-800">{text}</p>
        <p className="mt-1 text-right text-[10px] text-gray-400">{hint}</p>
        <div className="absolute -bottom-3 left-8 h-0 w-0"
          style={{ borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "12px solid white" }} />
      </div>
    </div>
  );

  if (style === "parchment") return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0">
      <div className="mx-6 h-3 rounded-t-[60%] bg-amber-400" />
      <div className="border-x border-amber-400 bg-amber-50 px-8 py-4">
        <p className="mb-2 text-center font-ahsing text-xs uppercase tracking-widest text-amber-800">{npcName}</p>
        <p className="text-center text-sm italic text-amber-900">{text}</p>
        <p className="mt-2 text-center text-[10px] text-amber-600">{hint}</p>
      </div>
    </div>
  );

  if (style === "typewriter") return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 border-t border-green-500/30 bg-gray-950 px-6 py-4 font-mono">
      <p className="mb-1 text-xs text-green-500/60">{npcName.toUpperCase()}&gt;</p>
      <p className="text-sm text-green-400">{text}<span className="animate-pulse">▌</span></p>
      <p className="mt-2 text-[10px] text-green-500/40">[ SPACE ] close</p>
    </div>
  );

  // chat_box
  return (
    <div className="pointer-events-none absolute bottom-0 left-0 right-0 border-t border-gray-200 bg-gray-100/95 px-4 py-3">
      <div className="flex items-end gap-2">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-400 font-ahsing text-xs text-white">
          {npcName.charAt(0)}
        </div>
        <div className="rounded-2xl rounded-bl-sm border border-gray-200 bg-white px-4 py-2 shadow-sm">
          <p className="mb-0.5 font-ahsing text-[10px] text-gray-400">{npcName}</p>
          <p className="text-sm text-gray-700">{text}</p>
        </div>
        <span className="pb-1 text-xs text-gray-400">{hint}</span>
      </div>
    </div>
  );
}

// ─── PendingDoorConfig ────────────────────────────────────────────────────────

function PendingDoorConfig({
  pos,
  rooms,
  currentRoomId,
  onSave,
  onCancel,
}: {
  pos: { x: number; y: number };
  rooms: SidebarRoom[];
  currentRoomId: string | null;
  onSave: (wall: PlacedDoor["wall"], linkedRoomId: string) => void;
  onCancel: () => void;
}) {
  const [wall, setWall] = useState<PlacedDoor["wall"]>("north");
  const [linkedRoomId, setLinkedRoomId] = useState("");
  const otherRooms = rooms.filter((r) => r.id !== currentRoomId);

  void pos;

  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center">
      <div className="min-w-[220px] rounded-lg border border-gray-600 bg-gray-900/95 px-5 py-4 shadow-xl backdrop-blur-sm">
        <p className="mb-3 text-sm font-semibold text-white">Configure Door</p>

        <div className="mb-3">
          <label className="mb-1 block text-[11px] text-gray-400">Wall</label>
          <select
            value={wall}
            onChange={(e) => setWall(e.target.value as PlacedDoor["wall"])}
            className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="north">North</option>
            <option value="east">East</option>
            <option value="west">West</option>
          </select>
        </div>

        <div className="mb-4">
          <label className="mb-1 block text-[11px] text-gray-400">Link to room</label>
          {otherRooms.length === 0 ? (
            <p className="text-xs text-gray-500">No other rooms to link to.</p>
          ) : (
            <select
              value={linkedRoomId}
              onChange={(e) => setLinkedRoomId(e.target.value)}
              className="w-full rounded border border-gray-600 bg-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="" disabled>Select a room…</option>
              {otherRooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => { if (linkedRoomId) onSave(wall, linkedRoomId); }}
            disabled={!linkedRoomId}
            className="flex-1 rounded bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Place Door
          </button>
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-xs text-gray-400 hover:bg-gray-700 hover:text-white"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
