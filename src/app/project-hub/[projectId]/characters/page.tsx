"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import { collection, addDoc, getDocs, deleteDoc, doc, setDoc, serverTimestamp } from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";
import {
  GRID_SIZE,
  FRAME_ANIMATION_DELAY,
  type Direction,
  type FrameIndex,
  type CharacterLayer,
  type LayeredCharacter,
  createEmptyLayeredCharacter,
} from "@/lib/characters";

const DIRECTIONS: Direction[] = ["down", "up", "left", "right"];
const DIRECTION_LABELS: Record<Direction, string> = {
  down: "Down",
  up: "Up",
  left: "Left",
  right: "Right",
};
const DIRECTION_ARROWS: Record<Direction, string> = {
  down: "v",
  up: "^",
  left: "<",
  right: ">",
};

const DIRECTION_TO_ROW: Record<Direction, number> = {
  up: 0,
  right: 1,
  down: 2,
  left: 3,
};

type ParsedFrameCache = Map<string, HTMLCanvasElement[][]>;

function parseSpritesheetToCanvases(
  dataUri: string
): Promise<HTMLCanvasElement[][]> {
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
        const frameCols: HTMLCanvasElement[] = [];
        for (let col = 0; col < 4; col++) {
          const c = document.createElement("canvas");
          c.width = GRID_SIZE;
          c.height = GRID_SIZE;
          const ctx = c.getContext("2d")!;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(
            srcCanvas,
            col * frameW, row * frameH, frameW, frameH,
            0, 0, GRID_SIZE, GRID_SIZE
          );
          frameCols.push(c);
        }
        rows.push(frameCols);
      }
      resolve(rows);
    };
    img.onerror = () => reject(new Error("Failed to load spritesheet"));
    img.src = dataUri;
  });
}

/** Convert legacy character doc (with frames but no layers) into a layers array */
function deserializeLayers(data: Record<string, unknown>): CharacterLayer[] {
  // New format: layers array
  const rawLayers = data.layers as CharacterLayer[] | undefined;
  if (rawLayers && rawLayers.length > 0) return rawLayers;

  // Legacy format: spritesheet field
  const legacySpritesheet = data.spritesheet as string | undefined;
  if (legacySpritesheet) {
    return [{
      id: "legacy_base",
      name: "base",
      spritesheet: legacySpritesheet,
      zIndex: 0,
    }];
  }

  return [];
}

export default function CharacterCreator() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  const [character, setCharacter] = useState<LayeredCharacter>(createEmptyLayeredCharacter);
  const [currentDirection, setCurrentDirection] = useState<Direction>("down");
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // AI generation state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  // Saved characters
  const [savedChars, setSavedChars] = useState<{ id: string; name: string; layers: CharacterLayer[] }[]>([]);

  // Scroll state
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<FrameIndex>(0);
  const parsedCacheRef = useRef<ParsedFrameCache>(new Map());

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Update scroll arrow visibility
  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  // Load saved characters from Firebase
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "characters")).then(
      (snapshot) => {
        const chars: { id: string; name: string; layers: CharacterLayer[] }[] = [];
        snapshot.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const layers = deserializeLayers(data);
          chars.push({ id: d.id, name: (data.name as string) ?? "Character", layers });
        });
        setSavedChars(chars);
        if (chars.length > 0 && !characterId) {
          const first = chars[0];
          setCharacterId(first.id);
          setCharacter({ name: first.name, layers: first.layers });
        }
      }
    );
  }, [user, projectId]);

  // Recheck scroll arrows when saved chars change
  useEffect(() => {
    // Delay to let DOM render
    const t = setTimeout(updateScrollState, 50);
    return () => clearTimeout(t);
  }, [savedChars, updateScrollState]);

  // Parse base layer spritesheet into canvas cache
  const refreshCache = useCallback(async (layers: CharacterLayer[]) => {
    const cache: ParsedFrameCache = new Map();
    for (const layer of layers) {
      if (!layer.spritesheet) continue;
      try {
        const parsed = await parseSpritesheetToCanvases(layer.spritesheet);
        cache.set(layer.id, parsed);
      } catch (err) {
        console.warn(`Failed to parse layer ${layer.name}:`, err);
      }
    }
    parsedCacheRef.current = cache;
  }, []);

  useEffect(() => {
    refreshCache(character.layers);
  }, [character.layers, refreshCache]);

  // Draw frame from base layer
  const drawFrame = useCallback(
    (ctx: CanvasRenderingContext2D, direction: Direction, frameIdx: FrameIndex) => {
      ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);
      const rowIdx = DIRECTION_TO_ROW[direction];

      for (const layer of character.layers) {
        const parsed = parsedCacheRef.current.get(layer.id);
        if (!parsed || !parsed[rowIdx] || !parsed[rowIdx][frameIdx]) continue;
        ctx.drawImage(parsed[rowIdx][frameIdx], 0, 0);
      }
    },
    [character.layers]
  );

  // Animation preview
  useEffect(() => {
    const interval = setInterval(() => {
      animFrameRef.current = ((animFrameRef.current + 1) % 4) as FrameIndex;
      const canvas = previewCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      drawFrame(ctx, currentDirection, animFrameRef.current);
    }, FRAME_ANIMATION_DELAY);
    return () => clearInterval(interval);
  }, [currentDirection, drawFrame]);

  const hasBase = character.layers.some((l) => l.name === "base");

  // AI Generate — always base
  const handleGenerate = useCallback(async () => {
    if (!aiPrompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    setGeneratedPreview(null);
    try {
      const res = await fetch("/api/generate-sprite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: aiPrompt.trim(), type: "character" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? "Generation failed");
        return;
      }
      setGeneratedPreview(data.image);
    } catch {
      setGenError("Failed to generate");
    } finally {
      setIsGenerating(false);
    }
  }, [aiPrompt, isGenerating]);

  const handleAcceptGenerated = useCallback(async () => {
    if (!generatedPreview) return;
    try {
      const newLayer: CharacterLayer = {
        id: `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: "base",
        spritesheet: generatedPreview,
        zIndex: 0,
      };

      setCharacter((prev) => ({
        ...prev,
        layers: [newLayer],
      }));

      setShowAiModal(false);
      setGeneratedPreview(null);
      setAiPrompt("");
    } catch {
      setGenError("Failed to set character");
    }
  }, [generatedPreview]);

  const handleSave = useCallback(async () => {
    if (!user) return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const data = {
        name: character.name,
        layers: character.layers.map((l) => ({
          id: l.id,
          name: l.name,
          spritesheet: l.spritesheet,
          zIndex: l.zIndex,
        })),
        updatedAt: serverTimestamp(),
      };
      let savedId = characterId;
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
        savedId = docRef.id;
        setCharacterId(docRef.id);
      }
      setSavedChars((prev) => {
        const existing = prev.findIndex((c) => c.id === savedId);
        const entry = { id: savedId!, name: character.name, layers: character.layers };
        if (existing >= 0) {
          const updated = [...prev];
          updated[existing] = entry;
          return updated;
        }
        return [...prev, entry];
      });

      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, character, characterId]);

  const handleDeleteChar = useCallback(async (charId: string) => {
    if (!user || !window.confirm("Are you sure you want to delete this character?")) return;
    try {
      const db = getFirebaseDb();
      await deleteDoc(doc(db, "users", user.uid, "projects", projectId, "characters", charId));
      setSavedChars((prev) => prev.filter((c) => c.id !== charId));
      // If we deleted the active character, clear it
      if (characterId === charId) {
        setCharacterId(null);
        setCharacter(createEmptyLayeredCharacter());
      }
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }, [user, projectId, characterId]);

  const handleNewCharacter = useCallback(() => {
    setCharacterId(null);
    setCharacter(createEmptyLayeredCharacter());
  }, []);

  const scrollBy = useCallback((delta: number) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: delta, behavior: "smooth" });
  }, []);

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

      <div className="flex flex-1 flex-col items-center bg-gray-50 p-8">
        {/* Character name */}
        <input
          type="text"
          value={character.name}
          maxLength={20}
          onChange={(e) =>
            setCharacter((prev) => ({ ...prev, name: e.target.value }))
          }
          className="mb-6 w-48 rounded border border-gray-300 px-3 py-1.5 text-center text-sm font-ahsing focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />

        {/* Animation preview */}
        <div className="mb-6 flex flex-col items-center">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Preview
          </h2>
          <canvas
            ref={previewCanvasRef}
            width={GRID_SIZE}
            height={GRID_SIZE}
            className="pixelated rounded-lg border-2 border-gray-300"
            style={{ width: 256, height: 256 }}
          />
          <div className="mt-4 flex justify-center gap-2">
            {DIRECTIONS.map((dir) => (
              <button
                key={dir}
                onClick={() => setCurrentDirection(dir)}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  currentDirection === dir
                    ? "bg-accent text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {DIRECTION_ARROWS[dir]} {DIRECTION_LABELS[dir]}
              </button>
            ))}
          </div>
        </div>

        {/* Generate button */}
        <button
          onClick={() => setShowAiModal(true)}
          className="mb-8 rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-purple-700 transition-colors"
        >
          {hasBase ? "Regenerate Character" : "Generate Base Character"}
        </button>

        {/* Saved characters */}
        <div className="w-full max-w-xl">
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Characters ({savedChars.length})
          </h2>
          <div className="relative flex items-center">
            {/* Left arrow */}
            {canScrollLeft && (
              <button
                onClick={() => scrollBy(-200)}
                className="absolute -left-4 z-10 flex h-[100px] w-8 items-center justify-center rounded-l-lg bg-white/90 border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 shadow-sm"
              >
                &lsaquo;
              </button>
            )}

            <div
              ref={scrollRef}
              onScroll={updateScrollState}
              className="flex gap-3 overflow-x-auto pb-2 px-1 scrollbar-hide"
              style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
            >
              {savedChars.map((sc) => (
                <div
                  key={sc.id}
                  className={`relative flex-shrink-0 flex flex-col items-center rounded-lg border-2 bg-white p-3 transition-colors cursor-pointer ${
                    characterId === sc.id
                      ? "border-accent shadow-md"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                  onClick={() => {
                    setCharacterId(sc.id);
                    setCharacter({ name: sc.name, layers: sc.layers });
                  }}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteChar(sc.id);
                    }}
                    className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-[10px] text-red-500 hover:bg-red-200 hover:text-red-700"
                    title="Delete character"
                  >
                    &times;
                  </button>
                  <SavedCharThumbnail layers={sc.layers} />
                  <span className="mt-2 text-xs font-ahsing text-gray-700 truncate w-16 text-center">
                    {sc.name}
                  </span>
                </div>
              ))}

              {/* New character card */}
              <button
                onClick={handleNewCharacter}
                className={`flex-shrink-0 flex flex-col items-center justify-center rounded-lg border-2 border-dashed bg-white p-3 transition-colors w-[88px] h-[100px] ${
                  characterId === null
                    ? "border-accent text-accent"
                    : "border-gray-300 text-gray-400 hover:border-gray-400 hover:text-gray-500"
                }`}
              >
                <span className="text-2xl leading-none">+</span>
                <span className="mt-1 text-[10px] font-medium">New</span>
              </button>
            </div>

            {/* Right arrow */}
            {canScrollRight && (
              <button
                onClick={() => scrollBy(200)}
                className="absolute -right-4 z-10 flex h-[100px] w-8 items-center justify-center rounded-r-lg bg-white/90 border border-gray-200 text-gray-500 hover:text-gray-700 hover:bg-gray-50 shadow-sm"
              >
                &rsaquo;
              </button>
            )}
          </div>
        </div>
      </div>

      {/* AI Generate Modal */}
      {showAiModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[420px] rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Generate Character</h2>
              <button
                onClick={() => {
                  setShowAiModal(false);
                  setGeneratedPreview(null);
                  setGenError(null);
                  setAiPrompt("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            </div>

            <p className="mb-3 text-xs text-gray-500">
              Describe your character. Examples: &quot;knight with blue armor&quot;, &quot;forest elf&quot;, &quot;red dragon&quot;
            </p>

            <textarea
              rows={3}
              placeholder="Describe your character..."
              value={aiPrompt}
              onChange={(e) => setAiPrompt(e.target.value)}
              className="mb-3 w-full resize-none rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isGenerating}
            />

            <button
              onClick={handleGenerate}
              disabled={isGenerating || !aiPrompt.trim()}
              className="mb-4 w-full rounded-lg bg-purple-600 px-3 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? "Generating..." : "Generate"}
            </button>

            {genError && (
              <p className="mb-3 text-sm text-red-500">{genError}</p>
            )}

            {generatedPreview && (
              <div className="space-y-3">
                <div className="flex justify-center">
                  <img
                    src={generatedPreview}
                    alt="Generated spritesheet"
                    className="pixelated rounded border border-gray-300"
                    style={{ width: 256, height: 256, imageRendering: "pixelated" }}
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAcceptGenerated}
                    className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                  >
                    Use This
                  </button>
                  <button
                    onClick={() => setGeneratedPreview(null)}
                    className="flex-1 rounded-lg bg-gray-100 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const DOWN_ROW = DIRECTION_TO_ROW["down"];

function SavedCharThumbnail({ layers }: { layers: CharacterLayer[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, GRID_SIZE, GRID_SIZE);

    for (const layer of layers) {
      if (!layer.spritesheet) continue;
      const img = new Image();
      img.onload = () => {
        const fw = img.width / 4;
        const fh = img.height / 4;
        ctx.drawImage(
          img,
          0, DOWN_ROW * fh, fw, fh,
          0, 0, GRID_SIZE, GRID_SIZE
        );
      };
      img.src = layer.spritesheet;
    }
  }, [layers]);

  return (
    <canvas
      ref={canvasRef}
      width={GRID_SIZE}
      height={GRID_SIZE}
      className="pixelated block rounded"
      style={{ width: 64, height: 64 }}
    />
  );
}
