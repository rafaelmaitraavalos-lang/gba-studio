"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { loadRooms, type RoomData } from "@/lib/rooms";
import { TILE_TYPES } from "@/lib/tiles";
import { getObjectTypeDef } from "@/lib/objects";
import {
  type GameState,
  type Interaction,
  initGameState,
  movePlayer,
} from "@/lib/builder-engine";

const TILE_SIZE = 32;
const DEPTH_HEIGHT = 6;

function getTileColor(id: string): { color: string; depthColor?: string } | null {
  const def = TILE_TYPES.find((t) => t.id === id);
  return def ?? null;
}

export default function BuilderMode() {
  const { user, loading } = useAuth();
  const { projectId, projectName } = useProject();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameStateRef = useRef<GameState | null>(null);

  const [gameState, setGameState] = useState<GameState | null>(null);
  const [roomsLoaded, setRoomsLoaded] = useState(false);
  const [noRooms, setNoRooms] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load rooms and init game
  useEffect(() => {
    if (!user || !projectId) return;
    loadRooms(user.uid, projectId).then((rooms) => {
      if (rooms.length === 0) {
        setNoRooms(true);
        setRoomsLoaded(true);
        return;
      }
      const state = initGameState(rooms);
      gameStateRef.current = state;
      setGameState(state);
      setRoomsLoaded(true);
    });
  }, [user, projectId]);

  // Key handler
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const state = gameStateRef.current;
      if (!state) return;

      if (e.key === "Escape") {
        const newState = { ...state, isPaused: !state.isPaused, activeInteraction: null };
        gameStateRef.current = newState;
        setGameState(newState);
        return;
      }

      if (state.isPaused) return;

      if (state.activeInteraction) {
        // Dismiss interaction on any key
        const newState = { ...state, activeInteraction: null };
        gameStateRef.current = newState;
        setGameState(newState);
        return;
      }

      const dirMap: Record<string, "up" | "down" | "left" | "right"> = {
        ArrowUp: "up",
        ArrowDown: "down",
        ArrowLeft: "left",
        ArrowRight: "right",
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };

      const direction = dirMap[e.key];
      if (direction) {
        e.preventDefault();
        const newState = movePlayer(state, direction);
        gameStateRef.current = newState;
        setGameState(newState);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Draw game
  useEffect(() => {
    if (!gameState) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const room = gameState.rooms.get(gameState.currentRoomId);
    if (!room) return;

    const w = room.cols * TILE_SIZE;
    const h = room.rows * TILE_SIZE;
    canvas.width = w;
    canvas.height = h;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);

    // Draw tiles
    for (let row = 0; row < room.rows; row++) {
      for (let col = 0; col < room.cols; col++) {
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        const tileId = room.tiles[row * room.cols + col];

        if (tileId) {
          const def = getTileColor(tileId);
          if (def) {
            if (def.depthColor) {
              ctx.fillStyle = def.color;
              ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE - DEPTH_HEIGHT);
              ctx.fillStyle = def.depthColor;
              ctx.fillRect(x, y + TILE_SIZE - DEPTH_HEIGHT, TILE_SIZE, DEPTH_HEIGHT);
            } else {
              ctx.fillStyle = def.color;
              ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            }
          }
        } else {
          ctx.fillStyle = (row + col) % 2 === 0 ? "#F5F5F5" : "#EBEBEB";
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Draw objects (skip collected chests)
    for (const obj of room.objects) {
      if (obj.type === "chest") {
        const key = `${room.id}:${obj.id}`;
        if (gameState.collectedChests.has(key)) continue;
      }
      const def = getObjectTypeDef(obj.type);
      if (!def) continue;
      const x = obj.col * TILE_SIZE;
      const y = obj.row * TILE_SIZE;
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.icon, x + TILE_SIZE / 2, y + TILE_SIZE / 2);
    }

    // Draw player
    const px = gameState.playerPos.col * TILE_SIZE;
    const py = gameState.playerPos.row * TILE_SIZE;
    ctx.fillStyle = "#3B82F6";
    ctx.fillRect(px + 4, py + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    // Direction indicator
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 12px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const arrows: Record<string, string> = {
      up: "\u25B2",
      down: "\u25BC",
      left: "\u25C0",
      right: "\u25B6",
    };
    ctx.fillText(arrows[gameState.playerDirection], px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  }, [gameState]);

  const handleResume = useCallback(() => {
    if (!gameStateRef.current) return;
    const newState = { ...gameStateRef.current, isPaused: false };
    gameStateRef.current = newState;
    setGameState(newState);
  }, []);

  if (loading || !user || !roomsLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-900">
        <p className="text-gray-400">Loading...</p>
      </div>
    );
  }

  if (noRooms) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900">
        <p className="text-gray-400">No rooms found. Build some rooms first!</p>
        <button
          onClick={() => router.push(`/project-hub/${projectId}/rooms`)}
          className="mt-4 rounded-lg bg-accent px-6 py-2 font-semibold text-white hover:bg-blue-700"
        >
          Build Rooms
        </button>
      </div>
    );
  }

  if (!gameState) return null;

  const currentRoom = gameState.rooms.get(gameState.currentRoomId);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900">
      {/* HUD */}
      <div className="mb-4 flex items-center gap-6">
        <span className="text-sm text-gray-400">
          {currentRoom?.name ?? "Unknown Room"}
        </span>
        <span className="text-xs text-gray-500">ESC to pause</span>
      </div>

      {/* Game canvas */}
      <div className="relative">
        <canvas
          ref={canvasRef}
          className="pixelated border-2 border-gray-700"
        />

        {/* Pause menu overlay */}
        {gameState.isPaused && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70">
            <h2 className="font-pixel text-lg text-white">Paused</h2>
            <div className="mt-6 flex flex-col gap-3">
              <button
                onClick={handleResume}
                className="rounded-lg bg-accent px-8 py-2 font-semibold text-white hover:bg-blue-700"
              >
                Resume
              </button>
              <button
                onClick={() => router.push(`/project-hub/${projectId}`)}
                className="rounded-lg bg-gray-700 px-8 py-2 font-semibold text-white hover:bg-gray-600"
              >
                Back to Hub
              </button>
            </div>
          </div>
        )}

        {/* Interaction popup */}
        {gameState.activeInteraction && !gameState.isPaused && (
          <div className="absolute inset-x-0 bottom-0 bg-black/80 p-4">
            <InteractionDisplay interaction={gameState.activeInteraction} />
            <p className="mt-2 text-center text-xs text-gray-400">
              Press any key to continue
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function InteractionDisplay({ interaction }: { interaction: Interaction }) {
  switch (interaction.type) {
    case "chest":
      return (
        <p className="text-center text-sm text-yellow-300">
          You found: {interaction.item}!
        </p>
      );
    case "npc":
      return (
        <p className="text-center text-sm text-blue-300">
          {interaction.dialogue}
        </p>
      );
    case "sign":
      return (
        <p className="text-center text-sm text-gray-300">
          {interaction.text}
        </p>
      );
    case "enemy":
      return (
        <p className="text-center text-sm text-red-300">
          Combat! Enemy HP: {interaction.hp} | Damage: {interaction.damage}
        </p>
      );
    default:
      return null;
  }
}
