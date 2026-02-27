"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import { addDoc, collection, getDocs, serverTimestamp } from "firebase/firestore";
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
    const DIR_ROW = 2; // down-facing row

    function draw(ts: number) {
      if (ts - last >= 150) { frame = (frame + 1) % 4; last = ts; }
      ctx!.clearRect(0, 0, W, H);
      ctx!.imageSmoothingEnabled = false;
      for (const img of images) {
        if (!img.complete || !img.naturalWidth) continue;
        const fw = img.naturalWidth / 4, fh = img.naturalHeight / 4;
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
    try {
      const res = await fetch("/api/generate-equipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characterName: selectedChar!.name,
          equippedItems: equippedList,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.image) { setGenError(data.error ?? "Generation failed"); return; }
      setResultImage(data.image);
    } catch {
      setGenError("Failed to generate");
    } finally {
      setIsGenerating(false);
    }
  }, [canGenerate, isGenerating, selectedChar, equippedList]);

  const handleSave = useCallback(async () => {
    if (!user || !resultImage || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      await addDoc(collection(db, "users", user.uid, "projects", projectId, "equipped"), {
        name:        resultName,
        spritesheet: resultImage,
        characterId: selectedCharId,
        equippedItems: equippedList,
        createdAt:   serverTimestamp(),
      });
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
          <button
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
            className="mt-4 rounded-xl bg-purple-600 px-10 py-3 text-base font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            {isGenerating ? "Generating…" : "Generate Equipped Character"}
          </button>
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
              alt="Generated spritesheet"
              style={{ width: 256, height: 256, imageRendering: "pixelated", display: "block" }}
              className="rounded-xl border border-gray-200"
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
          const fw = img.naturalWidth / 4, fh = img.naturalHeight / 4;
          ctx.drawImage(img, 0, 2 * fh, fw, fh, 0, 0, 64, 64); // down row = row 2
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
