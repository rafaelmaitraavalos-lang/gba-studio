"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import { collection, addDoc, doc, setDoc, serverTimestamp } from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";
import {
  GRID_SIZE,
  PIXEL_DISPLAY_SIZE,
  CANVAS_SIZE,
  FRAME_ANIMATION_DELAY,
  GBA_PALETTE,
  type PixelData,
  type Direction,
  type FrameIndex,
  type CharacterSprite,
  createEmptySprite,
  directionKey,
  floodFill,
} from "@/lib/characters";

type Tool = "pencil" | "eraser" | "fill" | "picker";

const DIRECTIONS: Direction[] = ["down", "up", "left", "right"];
const DIRECTION_LABELS: Record<Direction, string> = {
  down: "Down",
  up: "Up",
  left: "Left",
  right: "Right",
};
const TOOL_ICONS: Record<Tool, string> = {
  pencil: "\u25AA",
  eraser: "\u2715",
  fill: "\u25C6",
  picker: "\u25C9",
};
const TOOL_LABELS: Record<Tool, string> = {
  pencil: "Pencil",
  eraser: "Eraser",
  fill: "Fill",
  picker: "Picker",
};

export default function CharacterCreator() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  const [sprite, setSprite] = useState<CharacterSprite>(createEmptySprite);
  const [selectedColor, setSelectedColor] = useState<string>(GBA_PALETTE[0]);
  const [customPalette, setCustomPalette] = useState<string[]>([...GBA_PALETTE]);
  const [tool, setTool] = useState<Tool>("pencil");
  const [currentDirection, setCurrentDirection] = useState<Direction>("down");
  const [currentFrameIndex, setCurrentFrameIndex] = useState<FrameIndex>(0);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [editingSwatchIndex, setEditingSwatchIndex] = useState<number | null>(null);
  const [copyMenuOpen, setCopyMenuOpen] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const isPaintingRef = useRef(false);
  const animFrameRef = useRef<FrameIndex>(0);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const currentPixels = sprite.frames[directionKey(currentDirection)][currentFrameIndex];

  // Draw main canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const x = col * PIXEL_DISPLAY_SIZE;
        const y = row * PIXEL_DISPLAY_SIZE;
        ctx.fillStyle = (row + col) % 2 === 0 ? "#F0F0F0" : "#E0E0E0";
        ctx.fillRect(x, y, PIXEL_DISPLAY_SIZE, PIXEL_DISPLAY_SIZE);

        const color = currentPixels[row][col];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(x, y, PIXEL_DISPLAY_SIZE, PIXEL_DISPLAY_SIZE);
        }
      }
    }

    ctx.strokeStyle = "rgba(0,0,0,0.1)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= GRID_SIZE; i++) {
      const pos = i * PIXEL_DISPLAY_SIZE + 0.5;
      ctx.beginPath();
      ctx.moveTo(pos, 0);
      ctx.lineTo(pos, CANVAS_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, pos);
      ctx.lineTo(CANVAS_SIZE, pos);
      ctx.stroke();
    }
  }, [currentPixels]);

  // Animation preview
  useEffect(() => {
    const interval = setInterval(() => {
      animFrameRef.current = ((animFrameRef.current + 1) % 3) as FrameIndex;
      const canvas = previewCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;

      const scale = 3;
      ctx.clearRect(0, 0, GRID_SIZE * scale, GRID_SIZE * scale);

      const frameData = sprite.frames[directionKey(currentDirection)][animFrameRef.current];
      for (let row = 0; row < GRID_SIZE; row++) {
        for (let col = 0; col < GRID_SIZE; col++) {
          const color = frameData[row][col];
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(col * scale, row * scale, scale, scale);
          }
        }
      }
    }, FRAME_ANIMATION_DELAY);
    return () => clearInterval(interval);
  }, [sprite, currentDirection]);

  const getGridPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_SIZE / rect.width;
    const scaleY = CANVAS_SIZE / rect.height;
    const col = Math.floor((e.clientX - rect.left) * scaleX / PIXEL_DISPLAY_SIZE);
    const row = Math.floor((e.clientY - rect.top) * scaleY / PIXEL_DISPLAY_SIZE);
    if (col < 0 || col >= GRID_SIZE || row < 0 || row >= GRID_SIZE) return null;
    return { row, col };
  }, []);

  const applyTool = useCallback(
    (row: number, col: number) => {
      const key = directionKey(currentDirection);
      const fi = currentFrameIndex;

      if (tool === "pencil" || tool === "eraser") {
        const newColor = tool === "pencil" ? selectedColor : null;
        setSprite((prev) => {
          if (prev.frames[key][fi][row][col] === newColor) return prev;
          const newFrames = { ...prev.frames };
          const dirFrames = [...newFrames[key]] as [PixelData, PixelData, PixelData];
          const newGrid = dirFrames[fi].map((r) => [...r]);
          newGrid[row][col] = newColor;
          dirFrames[fi] = newGrid;
          newFrames[key] = dirFrames;
          return { ...prev, frames: newFrames };
        });
      } else if (tool === "fill") {
        setSprite((prev) => {
          const newFrames = { ...prev.frames };
          const dirFrames = [...newFrames[key]] as [PixelData, PixelData, PixelData];
          dirFrames[fi] = floodFill(dirFrames[fi], row, col, selectedColor);
          newFrames[key] = dirFrames;
          return { ...prev, frames: newFrames };
        });
      } else if (tool === "picker") {
        const pixelColor = sprite.frames[key][fi][row][col];
        if (pixelColor) setSelectedColor(pixelColor);
        setTool("pencil");
      }
    },
    [tool, selectedColor, currentDirection, currentFrameIndex, sprite]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = getGridPos(e);
      if (!pos) return;
      if (tool === "pencil" || tool === "eraser") isPaintingRef.current = true;
      applyTool(pos.row, pos.col);
    },
    [getGridPos, applyTool, tool]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isPaintingRef.current) return;
      const pos = getGridPos(e);
      if (!pos) return;
      applyTool(pos.row, pos.col);
    },
    [getGridPos, applyTool]
  );

  const stopPainting = useCallback(() => {
    isPaintingRef.current = false;
  }, []);

  const copyFrameTo = useCallback(
    (targetDir: Direction, targetFrame: FrameIndex) => {
      const srcKey = directionKey(currentDirection);
      const dstKey = directionKey(targetDir);
      setSprite((prev) => {
        const srcPixels = prev.frames[srcKey][currentFrameIndex].map((r) => [...r]);
        const newFrames = { ...prev.frames };
        const dirFrames = [...newFrames[dstKey]] as [PixelData, PixelData, PixelData];
        dirFrames[targetFrame] = srcPixels;
        newFrames[dstKey] = dirFrames;
        return { ...prev, frames: newFrames };
      });
      setCopyMenuOpen(false);
    },
    [currentDirection, currentFrameIndex]
  );

  const handleSave = useCallback(async () => {
    if (!user) return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const serializedFrames: Record<string, { pixels: string[] }[]> = {};
      for (const dir of DIRECTIONS) {
        const key = directionKey(dir);
        serializedFrames[key] = sprite.frames[key].map((frame) => ({
          pixels: frame.flat().map((cell) => cell ?? ""),
        }));
      }
      const data = {
        name: sprite.name,
        frames: serializedFrames,
        updatedAt: serverTimestamp(),
      };
      if (characterId) {
        await setDoc(
          doc(db, "users", user.uid, "projects", projectId, "characters", characterId),
          data,
          { merge: true }
        );
      } else {
        const docRef = await addDoc(
          collection(db, "users", user.uid, "projects", projectId, "characters"),
          { ...data, createdAt: serverTimestamp() }
        );
        setCharacterId(docRef.id);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, sprite, characterId]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ProjectHubNav projectId={projectId} onSave={handleSave} saveStatus={saveStatus} />

      <div className="flex flex-1">
        {/* Left sidebar */}
        <aside className="w-[200px] shrink-0 border-r border-gray-200 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Colors
          </h2>
          <div className="grid grid-cols-4 gap-1.5">
            {customPalette.map((color, i) => (
              <div key={i} className="relative">
                <button
                  onClick={() => {
                    setSelectedColor(color);
                    setEditingSwatchIndex(null);
                  }}
                  onDoubleClick={() => setEditingSwatchIndex(i)}
                  className={`h-10 w-10 rounded border border-gray-300 transition-all ${
                    selectedColor === color && editingSwatchIndex !== i
                      ? "ring-2 ring-accent ring-offset-2"
                      : ""
                  }`}
                  style={{ backgroundColor: color }}
                  title={color}
                />
                {editingSwatchIndex === i && (
                  <input
                    type="text"
                    autoFocus
                    defaultValue={color}
                    className="absolute left-0 top-full z-10 mt-1 w-20 rounded border border-gray-300 bg-white px-1 py-0.5 text-xs shadow"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        const val = (e.target as HTMLInputElement).value;
                        if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
                          setCustomPalette((prev) => {
                            const next = [...prev];
                            next[i] = val.toUpperCase();
                            return next;
                          });
                          setSelectedColor(val.toUpperCase());
                        }
                        setEditingSwatchIndex(null);
                      } else if (e.key === "Escape") {
                        setEditingSwatchIndex(null);
                      }
                    }}
                    onBlur={() => setEditingSwatchIndex(null)}
                  />
                )}
              </div>
            ))}
          </div>

          <hr className="my-4 border-gray-200" />

          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Tools
          </h2>
          <div className="flex flex-col gap-2">
            {(["pencil", "eraser", "fill", "picker"] as Tool[]).map((t) => (
              <button
                key={t}
                onClick={() => setTool(t)}
                className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-all ${
                  tool === t
                    ? "ring-2 ring-accent bg-blue-50"
                    : "hover:bg-gray-50"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-200 text-base">
                  {TOOL_ICONS[t]}
                </span>
                <span>{TOOL_LABELS[t]}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Center */}
        <main className="flex flex-1 flex-col items-center bg-gray-50 p-8">
          <input
            type="text"
            value={sprite.name}
            maxLength={20}
            onChange={(e) =>
              setSprite((prev) => ({ ...prev, name: e.target.value }))
            }
            className="mb-4 w-48 rounded border border-gray-300 px-3 py-1.5 text-center text-sm font-medium focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
          />

          <canvas
            ref={canvasRef}
            width={CANVAS_SIZE}
            height={CANVAS_SIZE}
            className="pixelated border border-gray-300"
            style={{ cursor: "crosshair" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={stopPainting}
            onMouseLeave={stopPainting}
          />

          {/* Frame strip */}
          <div className="mt-6 space-y-2">
            {DIRECTIONS.map((dir) => (
              <div key={dir} className="flex items-center gap-2">
                <span className="w-12 text-xs font-medium text-gray-500 capitalize">
                  {DIRECTION_LABELS[dir]}
                </span>
                {([0, 1, 2] as FrameIndex[]).map((fi) => (
                  <FrameThumbnail
                    key={fi}
                    pixels={sprite.frames[directionKey(dir)][fi]}
                    isSelected={
                      currentDirection === dir && currentFrameIndex === fi
                    }
                    onClick={() => {
                      setCurrentDirection(dir);
                      setCurrentFrameIndex(fi);
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
        </main>

        {/* Right sidebar */}
        <aside className="w-[200px] shrink-0 border-l border-gray-200 p-4">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Preview
          </h2>
          <div className="flex justify-center">
            <canvas
              ref={previewCanvasRef}
              width={48}
              height={48}
              className="pixelated rounded border border-gray-300"
            />
          </div>

          <div className="mt-3 flex justify-center gap-1">
            {DIRECTIONS.map((dir) => (
              <button
                key={dir}
                onClick={() => setCurrentDirection(dir)}
                className={`rounded px-2 py-1 text-xs font-medium transition-colors ${
                  currentDirection === dir
                    ? "bg-accent text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {DIRECTION_LABELS[dir]}
              </button>
            ))}
          </div>

          <hr className="my-4 border-gray-200" />

          <div className="relative">
            <button
              onClick={() => setCopyMenuOpen((v) => !v)}
              className="w-full rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
            >
              Copy Frame
            </button>
            {copyMenuOpen && (
              <div className="absolute left-0 top-full z-10 mt-1 w-full rounded-lg border border-gray-200 bg-white py-1 shadow-lg max-h-60 overflow-y-auto">
                {DIRECTIONS.map((dir) =>
                  ([0, 1, 2] as FrameIndex[]).map((fi) => {
                    if (dir === currentDirection && fi === currentFrameIndex) return null;
                    return (
                      <button
                        key={`${dir}-${fi}`}
                        onClick={() => copyFrameTo(dir, fi)}
                        className="block w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                      >
                        {DIRECTION_LABELS[dir]} Frame {fi + 1}
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function FrameThumbnail({
  pixels,
  isSelected,
  onClick,
}: {
  pixels: PixelData;
  isSelected: boolean;
  onClick: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);

    for (let row = 0; row < GRID_SIZE; row++) {
      for (let col = 0; col < GRID_SIZE; col++) {
        const color = pixels[row][col];
        if (color) {
          ctx.fillStyle = color;
          ctx.fillRect(col, row, 1, 1);
        }
      }
    }
  }, [pixels]);

  return (
    <button
      onClick={onClick}
      className={`block rounded ${
        isSelected ? "border-2 border-accent" : "border border-gray-300"
      }`}
    >
      <canvas
        ref={canvasRef}
        width={GRID_SIZE}
        height={GRID_SIZE}
        className="pixelated block"
        style={{ width: 48, height: 48 }}
      />
    </button>
  );
}
