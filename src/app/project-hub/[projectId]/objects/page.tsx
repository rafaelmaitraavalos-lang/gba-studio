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

interface SavedObject {
  id: string;
  name: string;
  description: string;
  imageBase64: string;
}

export default function ObjectGenerator() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  const [objectName, setObjectName] = useState("");
  const [description, setDescription] = useState("");
  const [placement, setPlacement] = useState("floor");

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);

  const [savedObjects, setSavedObjects] = useState<SavedObject[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Canvas ref for flip rendering
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load saved objects
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "objects")).then((snap) => {
      const items: SavedObject[] = snap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) ?? "Object",
        description: (d.data().description as string) ?? "",
        imageBase64: (d.data().imageBase64 as string) ?? "",
      }));
      setSavedObjects(items);
    });
  }, [user, projectId]);

  // Re-draw canvas whenever image or flip state changes
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !generatedImage) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.save();
      ctx.translate(flipH ? canvas.width : 0, flipV ? canvas.height : 0);
      ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    };
    img.src = generatedImage;
  }, [generatedImage, flipH, flipV]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    setGeneratedImage(null);
    setFlipH(false);
    setFlipV(false);
    try {
      const res = await fetch("/api/generate-object", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: objectName.trim() || "Object",
          description: description.trim(),
          placement,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? "Generation failed");
        return;
      }
      setGeneratedImage(data.image ?? null);
      if (!data.image) setGenError("No image returned");
    } catch {
      setGenError("Failed to generate object");
    } finally {
      setIsGenerating(false);
    }
  }, [objectName, description, isGenerating]);

  // Get the current flipped image as a data URL from the canvas
  function getFlippedDataUrl(): string | null {
    const canvas = previewCanvasRef.current;
    if (!canvas || !generatedImage) return null;
    return canvas.toDataURL("image/png");
  }

  const handleSave = useCallback(async () => {
    if (!user || !generatedImage) return;
    const imageToSave = getFlippedDataUrl() ?? generatedImage;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const name = objectName.trim() || "Untitled Object";
      const docRef = await addDoc(
        collection(db, "users", user.uid, "projects", projectId, "objects"),
        {
          name,
          description: description.trim(),
          imageBase64: imageToSave,
          createdAt: serverTimestamp(),
        }
      );
      setSavedObjects((prev) => [
        ...prev,
        { id: docRef.id, name, description: description.trim(), imageBase64: imageToSave },
      ]);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, projectId, generatedImage, objectName, description, flipH, flipV]);

  const handleDelete = useCallback(
    async (objectId: string) => {
      if (!user || !window.confirm("Delete this object?")) return;
      try {
        const db = getFirebaseDb();
        await deleteDoc(doc(db, "users", user.uid, "projects", projectId, "objects", objectId));
        setSavedObjects((prev) => prev.filter((o) => o.id !== objectId));
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
        <h1 className="mb-6 text-2xl font-ahsing text-foreground">Object Generator</h1>

        {/* Controls */}
        <div className="w-full max-w-md space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Object Name</label>
            <input
              type="text"
              value={objectName}
              onChange={(e) => setObjectName(e.target.value)}
              placeholder="e.g. Wooden Chest, Magic Altar"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isGenerating}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='e.g. "old wooden chest with iron lock", "glowing magic altar", "stone bookshelf full of books"'
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              disabled={isGenerating}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Placement</label>
            <select
              value={placement}
              onChange={(e) => setPlacement(e.target.value)}
              disabled={isGenerating}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="floor">Floor — top-down view, seen from above</option>
              <option value="north_wall">North Wall — against the back wall, front-facing</option>
              <option value="south_wall">South Wall — against the front wall, rear-facing</option>
              <option value="side_wall">East/West Wall — against a side wall, lateral view</option>
            </select>
          </div>

          <button
            onClick={handleGenerate}
            disabled={isGenerating || !description.trim()}
            className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating ? "Generating object..." : "Generate Object"}
          </button>

          {genError && <p className="text-sm text-red-500">{genError}</p>}
        </div>

        {/* Preview */}
        {generatedImage && (
          <div className="mt-8 flex flex-col items-center gap-4">
            <canvas
              ref={previewCanvasRef}
              width={256}
              height={256}
              className="rounded border border-gray-300 bg-checkerboard"
              style={{ imageRendering: "pixelated", width: 256, height: 256 }}
            />

            {/* Flip controls */}
            <div className="flex gap-3">
              <button
                onClick={() => setFlipH((f) => !f)}
                className={`rounded-lg border px-4 py-1.5 text-xs font-medium transition-colors ${
                  flipH
                    ? "border-purple-500 bg-purple-50 text-purple-700"
                    : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Flip Horizontal
              </button>
              <button
                onClick={() => setFlipV((f) => !f)}
                className={`rounded-lg border px-4 py-1.5 text-xs font-medium transition-colors ${
                  flipV
                    ? "border-purple-500 bg-purple-50 text-purple-700"
                    : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                }`}
              >
                Flip Vertical
              </button>
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

        {/* Object library */}
        <div className="mt-10 w-full max-w-2xl">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">
            Object Library ({savedObjects.length})
          </h2>

          {savedObjects.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              No objects saved yet. Generate one above!
            </p>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {savedObjects.map((obj) => (
                <ObjectCard key={obj.id} obj={obj} onDelete={() => handleDelete(obj.id)} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ObjectCard({
  obj,
  onDelete,
}: {
  obj: SavedObject;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-gray-200 bg-white p-3">
      {obj.imageBase64 ? (
        <img
          src={obj.imageBase64}
          alt={obj.name}
          className="block rounded"
          style={{ width: 64, height: 64, imageRendering: "pixelated" }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded bg-gray-100 text-gray-300 text-xs"
          style={{ width: 64, height: 64 }}
        >
          ?
        </div>
      )}
      <p className="mt-2 text-xs font-ahsing text-gray-700 truncate w-full text-center">
        {obj.name}
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
