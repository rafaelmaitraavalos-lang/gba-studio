"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
} from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";

interface SavedMob {
  id: string;
  name: string;
  description: string;
  spritesheet: string;
}

// Row order matches spritesheet: row 0=south(down), 1=west(left), 2=east(right), 3=north(up)
const DIR_LABELS = ["Down", "Left", "Right", "Up"] as const;

export default function MobGenerator() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  const [mobName, setMobName] = useState("");
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [spritesheet, setSpritesheet] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);
  const [previewDir, setPreviewDir] = useState(0); // index into DIR_LABELS, matches spritesheet row
  const [savedMobs, setSavedMobs] = useState<SavedMob[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const lastTickRef = useRef(0);
  const sheetImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load saved mobs
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "mobs")).then((snap) => {
      setSavedMobs(
        snap.docs.map((d) => ({
          id: d.id,
          name: (d.data().name as string) ?? "Mob",
          description: (d.data().description as string) ?? "",
          spritesheet: (d.data().spritesheet as string) ?? "",
        }))
      );
    });
  }, [user, projectId]);

  // Animate preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !spritesheet) {
      cancelAnimationFrame(rafRef.current);
      return;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => { sheetImgRef.current = img; };
    img.src = spritesheet;
    sheetImgRef.current = null;
    frameRef.current = 0;

    function animate(ts: number) {
      if (!ctx || !canvas) return;
      if (ts - lastTickRef.current >= 150) {
        frameRef.current = (frameRef.current + 1) % 8;
        lastTickRef.current = ts;
      }
      const sheet = sheetImgRef.current;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (sheet && sheet.complete && sheet.naturalWidth > 0) {
        const fw = sheet.naturalWidth / 8;
        const fh = sheet.naturalHeight / 4;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sheet, frameRef.current * fw, previewDir * fh, fw, fh, 0, 0, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spritesheet, previewDir]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    setSpritesheet(null);
    frameRef.current = 0;
    try {
      const res = await fetch("/api/generate-mob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: mobName.trim() || "Enemy",
          description: description.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? "Generation failed");
        return;
      }
      setSpritesheet(data.spritesheet ?? null);
      if (!data.spritesheet) setGenError("No spritesheet returned");
    } catch {
      setGenError("Failed to generate mob");
    } finally {
      setIsGenerating(false);
    }
  }, [mobName, description, isGenerating]);

  const handleSave = useCallback(async () => {
    if (!user || !spritesheet) return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const name = mobName.trim() || "Untitled Mob";
      const docRef = await addDoc(
        collection(db, "users", user.uid, "projects", projectId, "mobs"),
        { name, description: description.trim(), spritesheet, createdAt: serverTimestamp() }
      );
      setSavedMobs((prev) => [
        ...prev,
        { id: docRef.id, name, description: description.trim(), spritesheet },
      ]);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, spritesheet, mobName, description]);

  const handleDelete = useCallback(
    async (mobId: string) => {
      if (!user || !window.confirm("Delete this mob?")) return;
      try {
        const db = getFirebaseDb();
        await deleteDoc(doc(db, "users", user.uid, "projects", projectId, "mobs", mobId));
        setSavedMobs((prev) => prev.filter((m) => m.id !== mobId));
      } catch (err) {
        console.error("Delete failed:", err);
      }
    },
    [user, projectId]
  );

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
        onSave={() => {}}
        saveStatus="idle"
        saveDisabled
      />

      <div className="flex flex-1 flex-col items-center bg-gray-50 p-8">
        <h1 className="mb-6 text-2xl font-ahsing text-foreground">Mob Generator</h1>

        {/* Controls */}
        <div className="w-full max-w-md space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Mob Name</label>
            <input
              type="text"
              value={mobName}
              onChange={(e) => setMobName(e.target.value)}
              placeholder="e.g. Goblin Archer, Cave Slime, Shadow Bat"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isGenerating}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='"small green goblin with a bow", "blue gelatinous cave slime", "dark winged bat"'
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              disabled={isGenerating}
            />
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !description.trim()}
            className="w-full rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating ? "Generating mob..." : "Generate Mob"}
          </button>

          {genError && <p className="text-sm text-red-500">{genError}</p>}
        </div>

        {/* Preview */}
        {spritesheet && (
          <div className="mt-8 flex flex-col items-center gap-4">
            <canvas
              ref={previewCanvasRef}
              width={128}
              height={128}
              className="rounded border border-gray-300 bg-checkerboard"
              style={{ imageRendering: "pixelated", width: 128, height: 128 }}
            />

            {/* Direction selector */}
            <div className="flex gap-2">
              {DIR_LABELS.map((label, i) => (
                <button
                  key={label}
                  onClick={() => {
                    setPreviewDir(i);
                    frameRef.current = 0;
                  }}
                  className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                    previewDir === i
                      ? "bg-red-600 text-white"
                      : "border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <button
              onClick={handleSave}
              disabled={saveStatus === "saving"}
              className="rounded-lg bg-green-600 px-6 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : "Save to Library"}
            </button>
          </div>
        )}

        {/* Mob library */}
        <div className="mt-10 w-full max-w-2xl">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">
            Mob Library ({savedMobs.length})
          </h2>

          {savedMobs.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              No mobs saved yet. Generate one above!
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {savedMobs.map((mob) => (
                <MobCard key={mob.id} mob={mob} onDelete={() => handleDelete(mob.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MobCard({ mob, onDelete }: { mob: SavedMob; onDelete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const lastTickRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !mob.spritesheet) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => { imgRef.current = img; };
    img.src = mob.spritesheet;

    function animate(ts: number) {
      if (!ctx || !canvas) return;
      if (ts - lastTickRef.current >= 200) {
        frameRef.current = (frameRef.current + 1) % 8;
        lastTickRef.current = ts;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const sheet = imgRef.current;
      if (sheet && sheet.complete && sheet.naturalWidth > 0) {
        const fw = sheet.naturalWidth / 8;
        const fh = sheet.naturalHeight / 4;
        ctx.imageSmoothingEnabled = false;
        // Row 0 = south (down-facing)
        ctx.drawImage(sheet, frameRef.current * fw, 0, fw, fh, 0, 0, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mob.spritesheet]);

  return (
    <div className="flex flex-col items-center rounded-lg border border-gray-200 bg-white p-3">
      <canvas
        ref={canvasRef}
        width={64}
        height={64}
        className="rounded"
        style={{ imageRendering: "pixelated", width: 64, height: 64 }}
      />
      <p className="mt-2 text-xs font-ahsing text-gray-700 truncate w-full text-center">
        {mob.name}
      </p>
      <button
        onClick={onDelete}
        className="mt-1 text-[10px] text-red-400 hover:text-red-600"
      >
        Delete
      </button>
    </div>
  );
}
