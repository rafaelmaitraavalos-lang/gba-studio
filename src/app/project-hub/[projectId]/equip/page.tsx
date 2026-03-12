"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";
import { type CharacterLayer } from "@/lib/characters";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SavedChar {
  id: string;
  name: string;
  layers: CharacterLayer[];
}

interface SavedItem {
  id: string;
  name: string;
  slot: string;
  imageBase64: string;
}

const SLOTS = [
  { id: "head",      label: "Head" },
  { id: "body",      label: "Body" },
  { id: "hand",      label: "Hand" },
  { id: "feet",      label: "Feet" },
  { id: "accessory", label: "Accessory" },
] as const;

type Slot = typeof SLOTS[number]["id"];
type EquippedSlots = Partial<Record<Slot, SavedItem>>;

// ─── Spritesheet compositing ──────────────────────────────────────────────────

// Y position (fraction of frame height) and display size (fraction of frame width)
// for each equipment slot, applied uniformly across all 16 frames.
const SLOT_PLACEMENT: Record<string, { yFrac: number; sizeFrac: number }> = {
  head:      { yFrac: 0.05, sizeFrac: 0.35 },
  body:      { yFrac: 0.35, sizeFrac: 0.42 },
  hand:      { yFrac: 0.58, sizeFrac: 0.35 },
  feet:      { yFrac: 0.78, sizeFrac: 0.35 },
  accessory: { yFrac: 0.15, sizeFrac: 0.28 },
};

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function compositeEquippedSpritesheet(
  charSpritesheet: string,
  items: { slot: string; imageBase64: string }[],
): Promise<string> {
  const charImg = await loadImg(charSpritesheet);
  const W = charImg.naturalWidth, H = charImg.naturalHeight;
  const numCols = W / 64;               // 4 for Replicate (256px), 8 for PixelLab (512px)
  const frameW = 64, frameH = H / 4;   // frames are always 64×64

  const canvas = document.createElement("canvas");
  canvas.width  = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;

  // Draw the full character spritesheet as base
  ctx.drawImage(charImg, 0, 0);

  // Stamp each item icon onto all frames
  for (const item of items) {
    const placement = SLOT_PLACEMENT[item.slot];
    if (!placement) continue;
    const itemImg = await loadImg(item.imageBase64);
    const dw = Math.round(frameW * placement.sizeFrac);
    const dh = Math.round(frameH * placement.sizeFrac);

    ctx.globalAlpha = 0.88;
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < numCols; col++) {
        const fx = col * frameW;
        const fy = row * frameH;
        const ix = fx + (frameW - dw) / 2;          // center horizontally in frame
        const iy = fy + frameH * placement.yFrac;    // position vertically by slot
        ctx.drawImage(itemImg, ix, iy, dw, dh);
      }
    }
    ctx.globalAlpha = 1;
  }

  return canvas.toDataURL("image/png");
}

/**
 * Extract frame 0 from each of the 4 direction rows of a spritesheet.
 * Works for both 512×256 (8-col PixelLab) and 256×256 (4-col Replicate) sheets
 * because each frame is always 64×64 regardless of total width.
 * Returns raw base64 (no data URI prefix) per direction.
 */
async function extractDirectionFrames(
  spritesheet: string,
): Promise<{ south: string; west: string; east: string; north: string }> {
  const img = await loadImg(spritesheet);
  const fh = img.naturalHeight / 4; // always 64
  const dirs = ["south", "west", "east", "north"] as const;
  console.log(`[equip] extractDirectionFrames: sheet ${img.naturalWidth}×${img.naturalHeight}, fh=${fh}`);
  const result = {} as Record<string, string>;
  for (let row = 0; row < 4; row++) {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    // col 0, row N: sx=0, sy=row*fh, sw=64, sh=fh → dest 64×64
    ctx.drawImage(img, 0, row * fh, 64, fh, 0, 0, 64, 64);
    const b64 = c.toDataURL("image/png").replace(/^data:[^;]+;base64,/, "");
    console.log(`[equip] extractDirectionFrames: dir="${dirs[row]}" ← row ${row} (sy=${row * fh}) b64_len=${b64.length} prefix=${b64.slice(0, 12)}`);
    result[dirs[row]] = b64;
  }
  return result as { south: string; west: string; east: string; north: string };
}

// ─── Character canvas (animated walk preview) ─────────────────────────────────

function CharCanvas({ layers }: { layers: CharacterLayer[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !layers.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const images = layers
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((l) => { const img = new Image(); img.src = l.spritesheet; return img; });

    let frame = 0;
    let last  = 0;
    const W = canvas.width, H = canvas.height;
    const DIR_ROW = 0; // row 0 = south (down-facing)

    function draw(ts: number) {
      if (ts - last >= 150) { frame = (frame + 1) % 8; last = ts; }
      ctx!.clearRect(0, 0, W, H);
      ctx!.imageSmoothingEnabled = false;
      for (const img of images) {
        if (!img.complete || !img.naturalWidth) continue;
        const fw = img.naturalWidth / 8, fh = img.naturalHeight / 4;
        ctx!.drawImage(img, frame * fw, DIR_ROW * fh, fw, fh, 0, 0, W, H);
      }
      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [layers]);

  if (!layers.length) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-300">
        <span className="text-sm text-gray-400">Select a character</span>
      </div>
    );
  }
  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={64}
      style={{ width: 256, height: 256, imageRendering: "pixelated", display: "block" }}
      className="rounded-xl border-2 border-gray-200"
    />
  );
}

// ─── Slot box ─────────────────────────────────────────────────────────────────

function SlotBox({
  slot, item, onClick,
}: {
  slot: typeof SLOTS[number];
  item: SavedItem | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl border-2 border-gray-200 bg-white p-3 text-left transition-all hover:border-accent hover:shadow-sm"
    >
      <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-gray-100">
        {item ? (
          <img
            src={item.imageBase64}
            alt={item.name}
            style={{ width: 40, height: 40, imageRendering: "pixelated", display: "block" }}
          />
        ) : (
          <span className="text-lg text-gray-300">+</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{slot.label}</p>
        <p className="truncate text-sm font-ahsing text-gray-700">{item?.name ?? "Empty"}</p>
      </div>
    </button>
  );
}

// ─── Item picker modal ────────────────────────────────────────────────────────

function ItemPickerModal({
  slot, items, onPick, onClose,
}: {
  slot: typeof SLOTS[number];
  items: SavedItem[];
  onPick: (item: SavedItem) => void;
  onClose: () => void;
}) {
  const filtered = items.filter((i) => i.slot === slot.id);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="relative w-[420px] max-h-[70vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button onClick={onClose} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">✕</button>
        <p className="mb-4 text-lg font-ahsing text-foreground">
          Pick {slot.label} Item
        </p>
        {filtered.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-gray-400">No {slot.label.toLowerCase()} items saved.</p>
            <Link
              href="../items"
              className="mt-2 inline-block text-sm text-accent hover:underline"
            >
              Generate items →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {filtered.map((item) => (
              <button
                key={item.id}
                onClick={() => { onPick(item); onClose(); }}
                className="flex flex-col items-center rounded-lg border-2 border-gray-200 bg-gray-50 p-3 hover:border-accent hover:bg-blue-50 transition-all"
              >
                <img
                  src={item.imageBase64}
                  alt={item.name}
                  style={{ width: 48, height: 48, imageRendering: "pixelated", display: "block" }}
                />
                <span className="mt-2 text-center text-xs font-ahsing text-gray-700 leading-tight">{item.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Inner page (needs useSearchParams) ──────────────────────────────────────

function EquipPageInner() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [characters, setCharacters] = useState<SavedChar[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);
  const [equipped, setEquipped] = useState<EquippedSlots>({});
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);

  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [resultName, setResultName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [elapsed, setElapsed] = useState(0);
  const elapsedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [placement, setPlacement] = useState("right hip");
  const [customPlacement, setCustomPlacement] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load characters + items
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    const base = `users/${user.uid}/projects/${projectId}`;

    getDocs(collection(db, base, "characters")).then((snap) => {
      const chars: SavedChar[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        const rawLayers = data.layers as CharacterLayer[] | undefined;
        const legacySS  = data.spritesheet as string | undefined;
        const layers: CharacterLayer[] = rawLayers?.length
          ? rawLayers
          : legacySS ? [{ id: "legacy_base", name: "base", spritesheet: legacySS, zIndex: 0 }] : [];
        return { id: d.id, name: (data.name as string) ?? "Character", layers };
      }).filter((c) => c.layers.length > 0);
      setCharacters(chars);

      // Preselect from URL param or first char
      const urlId = searchParams.get("characterId");
      const pre = urlId ? chars.find((c) => c.id === urlId) : chars[0];
      if (pre) setSelectedCharId(pre.id);
    });

    getDocs(collection(db, base, "items")).then((snap) => {
      setSavedItems(snap.docs.map((d) => ({
        id:          d.id,
        name:        (d.data().name       as string) ?? "Item",
        slot:        (d.data().slot       as string) ?? "accessory",
        imageBase64: (d.data().imageBase64 as string) ?? "",
      })));
    });
  }, [user, projectId, searchParams]);

  const selectedChar = characters.find((c) => c.id === selectedCharId);
  const equippedList = Object.entries(equipped).map(([slot, item]) => ({ slot, name: item!.name }));
  const canGenerate  = !!selectedChar && equippedList.length > 0;

  // Auto-build result name
  useEffect(() => {
    if (!selectedChar) return;
    const itemNames = Object.values(equipped).map((i) => i?.name).filter(Boolean);
    setResultName(
      itemNames.length > 0
        ? `${selectedChar.name} with ${itemNames.join(" & ")}`
        : selectedChar.name
    );
  }, [selectedChar, equipped]);

  const handleGenerate = useCallback(async () => {
    if (!canGenerate || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    setResultImage(null);
    setSaveStatus("idle");
    setElapsed(0);
    elapsedIntervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);

    try {
      // Extract frame 0 per direction from the base spritesheet (client-side canvas)
      const sortedLayers = [...selectedChar!.layers].sort((a, b) => a.zIndex - b.zIndex);
      const baseSpritesheet = sortedLayers[0]?.spritesheet ?? null;

      let directionFrames: Record<string, string> | undefined;
      if (baseSpritesheet) {
        try {
          directionFrames = await extractDirectionFrames(baseSpritesheet);
        } catch (err) {
          console.warn("[equip] extractDirectionFrames failed:", err);
        }
      }

      const res = await fetch("/api/generate-equipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterName:    selectedChar!.name,
          equippedItems:    equippedList,
          directionFrames,
          characterSpritesheet: baseSpritesheet, // kept for Replicate fallback
          placement: placement === "custom" ? customPlacement.trim() : placement,
        }),
      });
      const data = await res.json();
      console.log("[equip] API status:", res.status);
      console.log("[equip] API response keys:", Object.keys(data));
      console.log("[equip] spritesheetUrl:", data.spritesheetUrl?.slice(0, 50));
      console.log("[equip] data.image:", data.image?.slice(0, 50));
      if (!res.ok || !data.image) { setGenError(data.error ?? "Generation failed"); return; }
      setResultImage(data.image);
    } catch {
      setGenError("Failed to generate");
    } finally {
      if (elapsedIntervalRef.current) clearInterval(elapsedIntervalRef.current);
      setIsGenerating(false);
    }
  }, [canGenerate, isGenerating, selectedChar, equippedList]);

  const handleSave = useCallback(async () => {
    if (!user || !resultImage || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      await addDoc(collection(db, "users", user.uid, "projects", projectId, "equipped"), {
        name:          resultName,
        spritesheet:   resultImage,
        characterId:   selectedCharId,
        equippedItems: equippedList,
        createdAt:     serverTimestamp(),
      });
      // Also stamp equippedSpritesheetUrl onto the character document itself
      if (selectedCharId) {
        await updateDoc(
          doc(db, "users", user.uid, "projects", projectId, "characters", selectedCharId),
          { equippedSpritesheetUrl: resultImage },
        );
      }
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, resultImage, resultName, selectedCharId, equippedList, saveStatus]);

  if (loading || !user) {
    return <div className="flex min-h-screen items-center justify-center"><p className="text-gray-500">Loading…</p></div>;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ProjectHubNav projectId={projectId} onSave={() => {}} saveStatus="idle" saveDisabled />

      <div className="flex flex-1 overflow-hidden bg-gray-50">
        {/* Left — character picker */}
        <aside className="flex w-44 flex-col gap-2 overflow-y-auto border-r border-gray-200 bg-white p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Characters</p>
          {characters.length === 0 && (
            <p className="text-xs text-gray-400">No characters saved</p>
          )}
          {characters.map((char) => (
            <button
              key={char.id}
              onClick={() => { setSelectedCharId(char.id); setEquipped({}); }}
              className={`flex flex-col items-center rounded-xl border-2 p-2 transition-all ${
                selectedCharId === char.id
                  ? "border-accent bg-blue-50 shadow-sm"
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              <CharThumb layers={char.layers} />
              <span className="mt-1 w-full truncate text-center text-xs font-ahsing text-gray-700">{char.name}</span>
            </button>
          ))}
        </aside>

        {/* Center — preview */}
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
          <CharCanvas layers={selectedChar?.layers ?? []} />
          {selectedChar && (
            <p className="text-lg font-ahsing text-foreground">{selectedChar.name}</p>
          )}
          {/* Item placement */}
          <div className="flex flex-col items-center gap-2">
            <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Item Placement
            </label>
            <select
              value={placement}
              onChange={(e) => setPlacement(e.target.value)}
              disabled={isGenerating}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
            >
              <option value="right hip">Right hip</option>
              <option value="left hip">Left hip</option>
              <option value="sheathed on back">Sheathed on back</option>
              <option value="left arm">Left arm</option>
              <option value="both hands">Both hands</option>
              <option value="custom">Custom…</option>
            </select>
            {placement === "custom" && (
              <input
                type="text"
                value={customPlacement}
                onChange={(e) => setCustomPlacement(e.target.value)}
                placeholder="e.g. floating behind shoulder"
                disabled={isGenerating}
                className="w-56 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
              />
            )}
          </div>

          <button
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating || (placement === "custom" && !customPlacement.trim())}
            className="mt-4 rounded-xl bg-purple-600 px-10 py-3 text-base font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            {isGenerating
              ? `Applying… ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`
              : "Apply Equipment"}
          </button>
          {isGenerating && (
            <p className="text-xs text-gray-400">Regenerating walk cycle for all 4 directions (~2 min)</p>
          )}
          {!canGenerate && !isGenerating && (
            <p className="text-xs text-gray-400">
              {!selectedChar ? "Select a character" : "Equip at least one item"}
            </p>
          )}
          {genError && <p className="text-sm text-red-500">{genError}</p>}
        </main>

        {/* Right — equipment slots */}
        <aside className="flex w-56 flex-col gap-3 overflow-y-auto border-l border-gray-200 bg-white p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Equipment</p>
          {SLOTS.map((slot) => (
            <div key={slot.id} className="relative">
              <SlotBox
                slot={slot}
                item={equipped[slot.id]}
                onClick={() => setActiveSlot(slot.id)}
              />
              {equipped[slot.id] && (
                <button
                  onClick={() => setEquipped((e) => { const next = { ...e }; delete next[slot.id]; return next; })}
                  className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-100 text-[9px] text-red-500 hover:bg-red-200"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </aside>
      </div>

      {/* Item picker modal */}
      {activeSlot && (
        <ItemPickerModal
          slot={SLOTS.find((s) => s.id === activeSlot)!}
          items={savedItems}
          onPick={(item) => setEquipped((e) => ({ ...e, [activeSlot]: item }))}
          onClose={() => setActiveSlot(null)}
        />
      )}

      {/* Result modal */}
      {resultImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setResultImage(null)}
        >
          <div
            className="relative flex flex-col items-center rounded-2xl bg-white px-10 py-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => setResultImage(null)} className="absolute right-4 top-4 text-gray-400 hover:text-gray-600">✕</button>
            <p className="mb-5 text-sm font-bold uppercase tracking-wider text-gray-400">Equipped Character</p>
            <img
              src={resultImage}
              alt="Equipped character"
              style={{
                imageRendering: "pixelated",
                width: "128px",
                height: "128px",
                objectFit: "none",
                objectPosition: "0 0",
              }}
            />
            <input
              type="text"
              value={resultName}
              onChange={(e) => setResultName(e.target.value)}
              className="mt-5 w-full rounded-lg border border-gray-300 px-3 py-2 text-center font-ahsing text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              placeholder="Name this character…"
            />
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving" || saveStatus === "saved"}
              className="mt-4 rounded-xl bg-green-600 px-10 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
            >
              {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved!" : "Save to Library"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Character thumbnail (static, down-facing frame 0) ─────────────────────

function CharThumb({ layers }: { layers: CharacterLayer[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 64, 64);
    layers
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex)
      .forEach((l) => {
        if (!l.spritesheet) return;
        const img = new Image();
        img.onload = () => {
          const fw = img.naturalWidth / 8, fh = img.naturalHeight / 4;
          ctx.drawImage(img, 0, 0, fw, fh, 0, 0, 64, 64); // frame 0, row 0 = south
        };
        img.src = l.spritesheet;
      });
  }, [layers]);
  return (
    <canvas
      ref={canvasRef}
      width={64}
      height={64}
      style={{ width: 56, height: 56, imageRendering: "pixelated", display: "block" }}
      className="rounded-lg"
    />
  );
}

// ─── Page wrapper (Suspense for useSearchParams) ──────────────────────────────

export default function EquipPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><p className="text-gray-500">Loading…</p></div>}>
      <EquipPageInner />
    </Suspense>
  );
}
