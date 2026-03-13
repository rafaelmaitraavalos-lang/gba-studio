"use client";

import { useCallback, useEffect, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";

// ─── Types ────────────────────────────────────────────────────────────────────

const ITEM_TYPES = ["weapon", "shield", "armor", "hat", "accessory"] as const;
type ItemType = typeof ITEM_TYPES[number];

interface RotationUrls {
  south: string;
  west:  string;
  east:  string;
  north: string;
}

interface SavedChar {
  id: string;
  name: string;
  spritesheetUrl: string;          // for thumbnail fallback
  characterDescription: string;
  rotationUrls?: RotationUrls;     // 4 idle frames (new V2 characters)
}

interface SavedItem {
  id: string;
  name: string;
  slot: string;
  imageBase64: string;
}

const SLOT_TO_ITEM_TYPE: Record<string, ItemType> = {
  hand:      "weapon",
  head:      "hat",
  body:      "armor",
  feet:      "accessory",
  accessory: "accessory",
};

// ─── Character thumbnail (first frame via canvas) ─────────────────────────────

function CharThumb({ url, size = 128 }: { url: string; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !url) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      const fh = img.naturalHeight / 4;
      const fw = fh;
      ctx.drawImage(img, 0, 0, fw, fh, 0, 0, size, size);
    };
    img.src = url;
  }, [url, size]);
  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: "pixelated", display: "block" }}
      className="rounded-lg"
    />
  );
}

// ─── Render a single 64×64 base64 image as a pixelated thumbnail ──────────────

function IdleThumb({ b64, label, size = 80 }: { b64: string; label: string; size?: number }) {
  const src = b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`;
  return (
    <div className="flex flex-col items-center gap-1">
      <img
        src={src}
        alt={label}
        style={{ width: size, height: size, imageRendering: "pixelated", display: "block" }}
        className="rounded-md border border-gray-200"
      />
      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{label}</span>
    </div>
  );
}

// ─── Section label ────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <div className="h-px flex-1 bg-gray-200" />
      <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">
        {children}
      </span>
      <div className="h-px flex-1 bg-gray-200" />
    </div>
  );
}

// ─── Inner page ───────────────────────────────────────────────────────────────

function EquipPageInner() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [characters, setCharacters]         = useState<SavedChar[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [savedItems, setSavedItems]         = useState<SavedItem[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const [itemDescription, setItemDescription] = useState("");
  const [itemType, setItemType]             = useState<ItemType>("weapon");

  // Step 1: generate idle equipped images
  const [isEquipping, setIsEquipping]         = useState(false);
  const [equippedIdleImages, setEquippedIdleImages] = useState<RotationUrls | null>(null);
  const [equippedItemType, setEquippedItemType]     = useState<string>("");

  // Step 2: animate equipped spritesheet
  const [isAnimating, setIsAnimating]         = useState(false);
  const [resultSpritesheetUrl, setResultSpritesheetUrl] = useState<string | null>(null);
  const [saveStatus, setSaveStatus]           = useState<"idle" | "saving" | "saved">("idle");

  const [genError, setGenError]   = useState<string | null>(null);
  const [elapsed, setElapsed]     = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load characters
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "characters")).then((snap) => {
      const chars: SavedChar[] = snap.docs
        .map((d) => {
          const data = d.data() as Record<string, unknown>;
          const layers = data.layers as { spritesheet?: string }[] | undefined;
          const spritesheetUrl =
            (data.spritesheetUrl as string | undefined) ??
            layers?.[0]?.spritesheet ??
            (data.spritesheet as string | undefined) ??
            "";
          const characterDescription =
            (data.description as string | undefined) ??
            (data.prompt as string | undefined) ??
            "";
          const rotationUrls = data.rotationUrls as RotationUrls | undefined;
          return {
            id: d.id,
            name:
              (data.name as string | undefined) ??
              (data.prompt as string | undefined) ??
              "Unnamed",
            spritesheetUrl,
            characterDescription,
            rotationUrls,
          };
        })
        .filter((c) => !!c.spritesheetUrl || !!c.rotationUrls);
      setCharacters(chars);
      const urlId = searchParams.get("characterId");
      const pre = urlId ? chars.find((c) => c.id === urlId) : chars[0];
      if (pre) setSelectedCharId(pre.id);
    });
  }, [user, projectId, searchParams]);

  // Load items
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "items")).then((snap) => {
      setSavedItems(
        snap.docs.map((d) => ({
          id:          d.id,
          name:        (d.data().name        as string) ?? "Item",
          slot:        (d.data().slot        as string) ?? "accessory",
          imageBase64: (d.data().imageBase64 as string) ?? "",
        })),
      );
    });
  }, [user, projectId]);

  const selectedChar = characters.find((c) => c.id === selectedCharId);
  const canEquip = !!selectedChar && itemDescription.trim().length > 0 && !isEquipping && !isAnimating;

  const handleItemCardClick = (item: SavedItem) => {
    setSelectedItemId(item.id);
    setItemDescription(item.name);
    setItemType(SLOT_TO_ITEM_TYPE[item.slot] ?? "accessory");
  };

  function startTimer() {
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }
  function stopTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }
  function fmtTime(s: number) {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }

  // Step 1: Inpaint idle equipped poses
  const handleEquip = useCallback(async () => {
    if (!canEquip || !selectedChar) return;
    setIsEquipping(true);
    setGenError(null);
    setEquippedIdleImages(null);
    setResultSpritesheetUrl(null);
    setSaveStatus("idle");
    startTimer();

    try {
      let requestBody: Record<string, unknown>;

      if (selectedChar.rotationUrls) {
        // New V2 character: use 4 individual direction images
        const { south, west, east, north } = selectedChar.rotationUrls;
        requestBody = {
          southImage: south,
          westImage:  west,
          eastImage:  east,
          northImage: north,
          itemDescription: itemDescription.trim(),
          itemType,
          characterDescription: selectedChar.characterDescription,
        };
      } else {
        // Legacy character: pass spritesheet URL, route extracts idle frames
        requestBody = {
          characterSpritesheetUrl: selectedChar.spritesheetUrl,
          itemDescription: itemDescription.trim(),
          itemType,
          characterDescription: selectedChar.characterDescription,
        };
      }

      const res = await fetch("/api/generate-equipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const data = await res.json() as {
        south?: string; west?: string; east?: string; north?: string;
        error?: string;
      };
      if (!res.ok || !data.south) {
        setGenError(data.error ?? "Failed to generate equipped poses");
        return;
      }
      setEquippedIdleImages({ south: data.south, west: data.west!, east: data.east!, north: data.north! });
      setEquippedItemType(itemType);
    } catch {
      setGenError("Failed to generate equipped poses");
    } finally {
      stopTimer();
      setIsEquipping(false);
    }
  }, [canEquip, selectedChar, itemDescription, itemType]);

  // Step 2: Animate equipped walk cycle
  const handleAnimate = useCallback(async () => {
    if (!equippedIdleImages || !selectedChar || isAnimating) return;
    setIsAnimating(true);
    setGenError(null);
    startTimer();

    try {
      const res = await fetch("/api/animate-equipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          southEquipped: equippedIdleImages.south,
          westEquipped:  equippedIdleImages.west,
          eastEquipped:  equippedIdleImages.east,
          northEquipped: equippedIdleImages.north,
          itemDescription: itemDescription.trim(),
          characterDescription: selectedChar.characterDescription,
        }),
      });
      const data = await res.json() as { spritesheetUrl?: string; error?: string };
      if (!res.ok || !data.spritesheetUrl) {
        setGenError(data.error ?? "Failed to animate");
        return;
      }
      setResultSpritesheetUrl(data.spritesheetUrl);
    } catch {
      setGenError("Failed to animate walk cycle");
    } finally {
      stopTimer();
      setIsAnimating(false);
    }
  }, [equippedIdleImages, selectedChar, itemDescription, isAnimating]);

  const handleSave = useCallback(async () => {
    if (!user || !resultSpritesheetUrl || !selectedCharId || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      await updateDoc(
        doc(db, "users", user.uid, "projects", projectId, "characters", selectedCharId),
        { equippedSpritesheetUrl: resultSpritesheetUrl },
      );
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, resultSpritesheetUrl, selectedCharId, saveStatus]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ProjectHubNav projectId={projectId} onSave={() => {}} saveStatus="idle" saveDisabled />

      <div className="flex flex-1 flex-col overflow-y-auto bg-gray-50">
        <div className="mx-auto w-full max-w-4xl px-6 pt-8 pb-16">

          {/* ── 1. Character grid ── */}
          <SectionLabel>Select Character</SectionLabel>
          {characters.length === 0 ? (
            <p className="mb-8 text-sm text-gray-400">No characters saved yet.</p>
          ) : (
            <div className="mb-10 flex flex-wrap justify-center gap-4">
              {characters.map((char) => (
                <button
                  key={char.id}
                  onClick={() => {
                    setSelectedCharId(char.id);
                    setEquippedIdleImages(null);
                    setResultSpritesheetUrl(null);
                    setSaveStatus("idle");
                    setGenError(null);
                  }}
                  className={`flex flex-col items-center rounded-2xl border-2 p-3 transition-all ${
                    selectedCharId === char.id
                      ? "border-purple-500 bg-purple-50 shadow-md"
                      : "border-gray-200 bg-white hover:border-gray-400 hover:shadow-sm"
                  }`}
                >
                  {char.rotationUrls?.south ? (
                    <IdleThumb b64={char.rotationUrls.south} label="" size={128} />
                  ) : (
                    <CharThumb url={char.spritesheetUrl} size={128} />
                  )}
                  <span className="mt-2 max-w-[128px] truncate text-center text-[11px] font-ahsing text-gray-600">
                    {char.name}
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* ── 2. Item grid ── */}
          {selectedChar && (
            <>
              <SectionLabel>Select Item</SectionLabel>
              {savedItems.length === 0 ? (
                <p className="mb-8 text-center text-sm text-gray-400">
                  No items saved —{" "}
                  <a href="../items" className="text-purple-500 hover:underline">generate items</a>
                  {" "}or type a custom description below.
                </p>
              ) : (
                <div className="mb-10 flex flex-wrap justify-center gap-3">
                  {savedItems.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => handleItemCardClick(item)}
                      className={`flex flex-col items-center rounded-xl border-2 p-3 transition-all ${
                        selectedItemId === item.id
                          ? "border-purple-500 bg-purple-50 shadow-md"
                          : "border-gray-200 bg-white hover:border-gray-400 hover:shadow-sm"
                      }`}
                    >
                      {item.imageBase64 ? (
                        <img
                          src={item.imageBase64}
                          alt={item.name}
                          style={{ width: 64, height: 64, imageRendering: "pixelated", display: "block" }}
                          className="rounded-md"
                        />
                      ) : (
                        <div className="flex h-16 w-16 items-center justify-center rounded-md bg-gray-100 text-2xl">
                          🗡
                        </div>
                      )}
                      <span className="mt-2 max-w-[80px] truncate text-center text-[11px] font-ahsing text-gray-700">
                        {item.name}
                      </span>
                      <span className="mt-1 rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-400">
                        {item.slot}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* ── 3. Equip form ── */}
          {selectedChar ? (
            <>
              <SectionLabel>Equip</SectionLabel>
              <div className="mx-auto flex w-full max-w-[480px] flex-col gap-5 rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Item Description
                  </label>
                  <input
                    type="text"
                    value={itemDescription}
                    onChange={(e) => { setItemDescription(e.target.value); setSelectedItemId(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleEquip(); }}
                    placeholder="e.g. iron longsword"
                    disabled={isEquipping || isAnimating}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Item Type
                  </label>
                  <select
                    value={itemType}
                    onChange={(e) => setItemType(e.target.value as ItemType)}
                    disabled={isEquipping || isAnimating}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
                  >
                    {ITEM_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t.charAt(0).toUpperCase() + t.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Step 1: Preview equipped poses */}
                <button
                  onClick={handleEquip}
                  disabled={!canEquip}
                  className="rounded-xl bg-purple-600 py-3 text-base font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
                >
                  {isEquipping
                    ? `Generating poses… ${fmtTime(elapsed)}`
                    : equippedIdleImages
                    ? "Regenerate Poses"
                    : "Preview Equipped Poses"}
                </button>

                {isEquipping && (
                  <div className="flex flex-col items-center gap-2 pt-1">
                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" />
                    <p className="text-center text-xs text-gray-500">
                      Inpainting{" "}
                      <span className="font-semibold text-gray-700">{selectedChar.name}</span>
                      {" "}with{" "}
                      <span className="font-semibold text-gray-700">{itemDescription}</span>
                      {" "}for all 4 directions…
                    </p>
                  </div>
                )}

                {/* Idle direction previews */}
                {equippedIdleImages && !isEquipping && (
                  <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <p className="text-center text-[10px] font-bold uppercase tracking-wider text-gray-400">
                      Equipped poses — {equippedItemType}
                    </p>
                    <div className="flex justify-center gap-4">
                      <IdleThumb b64={equippedIdleImages.south} label="South" />
                      <IdleThumb b64={equippedIdleImages.west}  label="West"  />
                      <IdleThumb b64={equippedIdleImages.east}  label="East"  />
                      <IdleThumb b64={equippedIdleImages.north} label="North" />
                    </div>

                    {/* Step 2: Animate walk cycle */}
                    {!resultSpritesheetUrl && (
                      <button
                        onClick={handleAnimate}
                        disabled={isAnimating}
                        className="mt-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                      >
                        {isAnimating
                          ? `Animating walk… ${fmtTime(elapsed)}`
                          : "Animate Walk Cycle"}
                      </button>
                    )}
                    {isAnimating && (
                      <div className="flex flex-col items-center gap-2">
                        <div className="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600" />
                        <p className="text-center text-xs text-gray-500">Animating all 4 directions…</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Final spritesheet result */}
                {resultSpritesheetUrl && (
                  <div className="flex flex-col items-center gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Walk Cycle</p>
                    <img
                      src={resultSpritesheetUrl}
                      alt="Equipped spritesheet"
                      style={{ imageRendering: "pixelated", width: 256, height: "auto" }}
                      className="rounded-lg"
                    />
                    <button
                      onClick={handleSave}
                      disabled={saveStatus === "saving" || saveStatus === "saved"}
                      className="w-full rounded-xl bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
                    >
                      {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved!" : "Save to Character"}
                    </button>
                  </div>
                )}

                {genError && (
                  <p className="text-center text-sm text-red-500">{genError}</p>
                )}
              </div>
            </>
          ) : (
            <p className="mt-4 text-center text-sm text-gray-400">Select a character above to get started</p>
          )}

        </div>
      </div>
    </div>
  );
}

// ─── Page wrapper ─────────────────────────────────────────────────────────────

export default function EquipPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-gray-500">Loading…</p>
        </div>
      }
    >
      <EquipPageInner />
    </Suspense>
  );
}
