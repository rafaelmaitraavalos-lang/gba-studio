"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import {
  collection,
  addDoc,
  getDocs,
  deleteDoc,
  doc,
  serverTimestamp,
} from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";

const ACCESSORY_TYPES = [
  { value: "cape", label: "Cape" },
  { value: "hat", label: "Hat" },
  { value: "shield", label: "Shield" },
  { value: "weapon", label: "Weapon" },
  { value: "belt", label: "Belt" },
  { value: "boots", label: "Boots" },
  { value: "gloves", label: "Gloves" },
];

/** Each direction has 2 frames: [rest, movement]. Slots can be null if generation failed. */
interface DirectionFrames {
  front: [string | null, string | null];
  back: [string | null, string | null];
  left: [string | null, string | null];
  right: [string | null, string | null];
}

interface SavedAccessory {
  id: string;
  name: string;
  type: string;
  images: DirectionFrames;
}

/** Convert old single-image format to 2-frame format */
function normalizeImages(data: Record<string, unknown>): DirectionFrames {
  const imgs = data.images as DirectionFrames | Record<string, string | string[]> | undefined;
  if (imgs) {
    // Already new format (arrays)
    if (Array.isArray(imgs.front)) return imgs as DirectionFrames;
    // Old format: single string per direction → duplicate as both frames
    return {
      front: [imgs.front as string, imgs.front as string],
      back:  [imgs.back as string, imgs.back as string],
      left:  [imgs.left as string, imgs.left as string],
      right: [imgs.right as string, imgs.right as string],
    };
  }
  // Very old format: single spritesheet field
  const ss = (data.spritesheet as string) ?? "";
  return { front: [ss, ss], back: ["", ""], left: ["", ""], right: ["", ""] };
}

export default function AccessoryGenerator() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  const [prompt, setPrompt] = useState("");
  const [accessoryType, setAccessoryType] = useState("cape");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedPreview, setGeneratedPreview] = useState<DirectionFrames | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [savedAccessories, setSavedAccessories] = useState<SavedAccessory[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load saved accessories
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(
      collection(db, "users", user.uid, "projects", projectId, "accessories")
    ).then((snapshot) => {
      const items: SavedAccessory[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        items.push({
          id: d.id,
          name: (data.name as string) ?? "Accessory",
          type: (data.type as string) ?? "accessory",
          images: normalizeImages(data),
        });
      });
      setSavedAccessories(items);
    });
  }, [user, projectId]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    setGeneratedPreview(null);
    try {
      const res = await fetch("/api/generate-accessory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: prompt.trim(),
          accessoryType,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? "Generation failed");
        return;
      }
      setGeneratedPreview(data.images);
    } catch {
      setGenError("Failed to generate accessory");
    } finally {
      setIsGenerating(false);
    }
  }, [prompt, accessoryType, isGenerating]);

  const handleSaveToLibrary = useCallback(async () => {
    if (!user || !generatedPreview) return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const name = prompt.trim().slice(0, 30) || "Accessory";
      const docRef = await addDoc(
        collection(db, "users", user.uid, "projects", projectId, "accessories"),
        {
          name,
          type: accessoryType,
          images: generatedPreview,
          createdAt: serverTimestamp(),
        }
      );
      setSavedAccessories((prev) => [
        ...prev,
        { id: docRef.id, name, type: accessoryType, images: generatedPreview },
      ]);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, generatedPreview, prompt, accessoryType]);

  const handleDelete = useCallback(
    async (accessoryId: string) => {
      if (!user) return;
      try {
        const db = getFirebaseDb();
        await deleteDoc(
          doc(db, "users", user.uid, "projects", projectId, "accessories", accessoryId)
        );
        setSavedAccessories((prev) => prev.filter((a) => a.id !== accessoryId));
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [user, projectId]
  );

  const handleNavSave = useCallback(() => {}, []);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ProjectHubNav
        projectId={projectId}
        onSave={handleNavSave}
        saveStatus="idle"
        saveDisabled
      />

      <div className="flex flex-1 flex-col items-center bg-gray-50 p-8">
        <h1 className="mb-6 text-2xl font-ahsing text-foreground">
          Accessory Generator
        </h1>

        {/* Generator controls */}
        <div className="w-full max-w-md space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Accessory Type
            </label>
            <select
              value={accessoryType}
              onChange={(e) => setAccessoryType(e.target.value)}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {ACCESSORY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Description
            </label>
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='e.g. "flowing red cape", "golden crown"'
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isGenerating}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleGenerate();
              }}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating ? "Generating 8 frames..." : "Generate Accessory"}
          </button>

          {genError && (
            <p className="text-sm text-red-500">{genError}</p>
          )}
        </div>

        {/* Preview — 2x2 direction grid with animated frames */}
        {generatedPreview && (
          <div className="mt-6 flex flex-col items-center space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {(["front", "back", "left", "right"] as const).map((dir) => (
                <div key={dir} className="flex flex-col items-center">
                  <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    {dir}
                  </span>
                  <AnimatedFrames
                    frames={generatedPreview[dir]}
                    alt={`${dir} view`}
                    size={128}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={handleSaveToLibrary}
              disabled={saveStatus === "saving"}
              className="rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saveStatus === "saving"
                ? "Saving..."
                : saveStatus === "saved"
                  ? "Saved!"
                  : "Save to Library"}
            </button>
          </div>
        )}

        {/* Saved accessories library */}
        <div className="mt-10 w-full max-w-2xl">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">
            Accessory Library ({savedAccessories.length})
          </h2>

          {savedAccessories.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              No accessories saved yet. Generate one above!
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {savedAccessories.map((acc) => (
                <AccessoryCard
                  key={acc.id}
                  accessory={acc}
                  onDelete={() => handleDelete(acc.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Loops between 2 frames at ~3fps. Handles null slots gracefully. */
function AnimatedFrames({
  frames,
  alt,
  size,
}: {
  frames: [string | null, string | null];
  alt: string;
  size: number;
}) {
  const [frameIdx, setFrameIdx] = useState(0);
  const validFrames = frames.filter((f): f is string => f !== null);

  useEffect(() => {
    if (validFrames.length < 2) return;
    const interval = setInterval(() => {
      setFrameIdx((prev) => (prev === 0 ? 1 : 0));
    }, 333);
    return () => clearInterval(interval);
  }, [validFrames.length]);

  if (validFrames.length === 0) {
    return (
      <div
        className="flex items-center justify-center rounded border border-gray-300 bg-gray-100 text-gray-400 text-xs"
        style={{ width: size, height: size }}
      >
        failed
      </div>
    );
  }

  const src = validFrames.length === 1 ? validFrames[0] : validFrames[frameIdx];

  return (
    <img
      src={src}
      alt={alt}
      className="pixelated rounded border border-gray-300"
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}

function AccessoryCard({
  accessory,
  onDelete,
}: {
  accessory: SavedAccessory;
  onDelete: () => void;
}) {
  const frontFrames = accessory.images.front;
  const hasFront = frontFrames[0] !== null && frontFrames[0] !== "";

  return (
    <div className="flex flex-col items-center rounded-lg border border-gray-200 bg-white p-3">
      {hasFront ? (
        <AnimatedFrames frames={frontFrames} alt={accessory.name} size={64} />
      ) : (
        <div className="flex h-16 w-16 items-center justify-center rounded bg-gray-100 text-gray-300 text-xs">
          ?
        </div>
      )}
      <p className="mt-2 text-xs font-ahsing text-gray-700 truncate w-full text-center">
        {accessory.name}
      </p>
      <span className="text-[10px] text-gray-400 capitalize">{accessory.type}</span>
      <button
        onClick={onDelete}
        className="mt-1 text-[10px] text-red-400 hover:text-red-600"
      >
        Delete
      </button>
    </div>
  );
}
