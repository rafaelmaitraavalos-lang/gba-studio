"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getFirebaseDb } from "@/lib/firebase";
import { collection, addDoc, doc, setDoc, serverTimestamp } from "firebase/firestore";
import { TILE_TYPES, type TileType } from "@/lib/tiles";

const COLS = 16;
const ROWS = 10;
const TILE_SIZE = 32;
const DEPTH_HEIGHT = 6;
const CANVAS_WIDTH = COLS * TILE_SIZE;
const CANVAS_HEIGHT = ROWS * TILE_SIZE;

type TileGrid = (string | null)[][];

function createEmptyGrid(): TileGrid {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(null));
}

function getTileDef(id: string): TileType | undefined {
  return TILE_TYPES.find((t) => t.id === id);
}

export default function ProjectHub() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPaintingRef = useRef(false);

  const [tiles, setTiles] = useState<TileGrid>(createEmptyGrid);
  const [selectedTile, setSelectedTile] = useState<string | null>("grass");
  const [roomId, setRoomId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Auth gate
  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  // Draw grid
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Draw tiles
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        const tileId = tiles[row][col];

        if (tileId) {
          const def = getTileDef(tileId);
          if (def) {
            if (def.depthColor) {
              // Wall/door: main color on top, depth face on bottom
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
          // Checkerboard for empty cells
          ctx.fillStyle = (row + col) % 2 === 0 ? "#F5F5F5" : "#EBEBEB";
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Grid lines
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1;
    for (let col = 0; col <= COLS; col++) {
      const x = col * TILE_SIZE + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, CANVAS_HEIGHT);
      ctx.stroke();
    }
    for (let row = 0; row <= ROWS; row++) {
      const y = row * TILE_SIZE + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(CANVAS_WIDTH, y);
      ctx.stroke();
    }
  }, [tiles]);

  const paintTile = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleX = CANVAS_WIDTH / rect.width;
      const scaleY = CANVAS_HEIGHT / rect.height;
      const col = Math.floor((e.clientX - rect.left) * scaleX / TILE_SIZE);
      const row = Math.floor((e.clientY - rect.top) * scaleY / TILE_SIZE);
      if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
      setTiles((prev) => {
        if (prev[row][col] === selectedTile) return prev;
        const next = prev.map((r) => [...r]);
        next[row][col] = selectedTile;
        return next;
      });
    },
    [selectedTile]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      isPaintingRef.current = true;
      paintTile(e);
    },
    [paintTile]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isPaintingRef.current) return;
      paintTile(e);
    },
    [paintTile]
  );

  const stopPainting = useCallback(() => {
    isPaintingRef.current = false;
  }, []);

  const handleSave = useCallback(async () => {
    if (!user) return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const serialized = tiles.map((row) =>
        row.map((cell) => cell ?? "")
      );
      if (roomId) {
        await setDoc(
          doc(db, "users", user.uid, "rooms", roomId),
          { tiles: serialized, updatedAt: serverTimestamp() },
          { merge: true }
        );
      } else {
        const docRef = await addDoc(
          collection(db, "users", user.uid, "rooms"),
          { tiles: serialized, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }
        );
        setRoomId(docRef.id);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, tiles, roomId]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Navbar */}
      <nav className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <div className="flex items-center gap-6">
          <span className="font-pixel text-sm text-accent">GBA Studio</span>
          <Link href="/" className="text-sm text-gray-500 hover:text-foreground">
            &larr; Back
          </Link>
        </div>
        <button
          onClick={handleSave}
          disabled={saveStatus === "saving"}
          className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
        >
          {saveStatus === "saving"
            ? "Saving..."
            : saveStatus === "saved"
              ? "Saved!"
              : "Save"}
        </button>
      </nav>

      {/* Editor */}
      <div className="flex flex-1">
        {/* Sidebar */}
        <aside className="w-[200px] shrink-0 border-r border-gray-200 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Tiles
          </h2>
          <div className="flex flex-col gap-2">
            {TILE_TYPES.map((tile) => (
              <button
                key={tile.id}
                onClick={() => setSelectedTile(tile.id)}
                className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-all ${
                  selectedTile === tile.id
                    ? "ring-2 ring-accent bg-blue-50"
                    : "hover:bg-gray-50"
                }`}
              >
                <span
                  className="block h-8 w-8 shrink-0 rounded"
                  style={{ backgroundColor: tile.color }}
                />
                <span>{tile.label}</span>
              </button>
            ))}
          </div>

          <hr className="my-4 border-gray-200" />

          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Tools
          </h2>
          <button
            onClick={() => setSelectedTile(null)}
            className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-all ${
              selectedTile === null
                ? "ring-2 ring-accent bg-blue-50"
                : "hover:bg-gray-50"
            }`}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-200 text-base">
              &#x2715;
            </span>
            <span>Eraser</span>
          </button>
        </aside>

        {/* Canvas area */}
        <main className="flex flex-1 items-center justify-center bg-gray-50 p-8">
          <canvas
            ref={canvasRef}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
            className="pixelated border border-gray-300"
            style={{ cursor: "crosshair" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopPainting}
            onMouseLeave={stopPainting}
          />
        </main>
      </div>
    </div>
  );
}
