"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp } from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";

const SLOTS = [
  { id: "head",      label: "Head" },
  { id: "body",      label: "Body" },
  { id: "hand",      label: "Hand" },
  { id: "feet",      label: "Feet" },
  { id: "accessory", label: "Accessory" },
] as const;

type Slot = typeof SLOTS[number]["id"];

interface SavedItem {
  id: string;
  name: string;
  slot: string;
  imageBase64: string;
}

export default function ItemGenerator() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  const [itemName,    setItemName]    = useState("");
  const [description, setDescription] = useState("");
  const [slot,        setSlot]        = useState<Slot>("hand");

  const [isGenerating, setIsGenerating] = useState(false);
  const [genError,     setGenError]     = useState<string | null>(null);

  // Modal state
  const [modalImage, setModalImage] = useState<string | null>(null);
  const [modalName,  setModalName]  = useState("");
  const [modalSlot,  setModalSlot]  = useState<Slot>("hand");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // Library
  const [savedItems, setSavedItems] = useState<SavedItem[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load saved items
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "items")).then((snap) => {
      setSavedItems(snap.docs.map((d) => ({
        id:          d.id,
        name:        (d.data().name  as string) ?? "Item",
        slot:        (d.data().slot  as string) ?? "accessory",
        imageBase64: (d.data().imageBase64 as string) ?? "",
      })));
    });
  }, [user, projectId]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      const res = await fetch("/api/generate-item", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:        itemName.trim() || "Item",
          description: description.trim(),
          slot,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.image) {
        setGenError(data.error ?? "Generation failed");
        return;
      }
      setModalName(itemName.trim() || "Item");
      setModalSlot(slot);
      setModalImage(data.image);
      setSaveStatus("idle");
    } catch {
      setGenError("Failed to generate item");
    } finally {
      setIsGenerating(false);
    }
  }, [itemName, description, slot, isGenerating]);

  const handleSave = useCallback(async () => {
    if (!user || !modalImage || saveStatus === "saving") return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const docRef = await addDoc(collection(db, "users", user.uid, "projects", projectId, "items"), {
        name:        modalName,
        description: description.trim(),
        slot:        modalSlot,
        imageBase64: modalImage,
        createdAt:   serverTimestamp(),
      });
      setSavedItems((prev) => [...prev, { id: docRef.id, name: modalName, slot: modalSlot, imageBase64: modalImage }]);
      setSaveStatus("saved");
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, modalImage, modalName, modalSlot, description, saveStatus]);

  const handleDelete = useCallback(async (itemId: string) => {
    if (!user || !window.confirm("Delete this item?")) return;
    try {
      const db = getFirebaseDb();
      await deleteDoc(doc(db, "users", user.uid, "projects", projectId, "items", itemId));
      setSavedItems((prev) => prev.filter((i) => i.id !== itemId));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }, [user, projectId]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <ProjectHubNav projectId={projectId} onSave={() => {}} saveStatus="idle" saveDisabled />

      <div className="flex flex-1 flex-col items-center bg-gray-50 p-8">
        <h1 className="mb-8 text-2xl font-ahsing text-foreground">Item Generator</h1>

        <div className="w-full max-w-md space-y-5">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Item Name</label>
            <input
              type="text"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. Iron Sword, Leather Cap, Ring of Speed"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isGenerating}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='e.g. "a rusty iron sword with a worn leather grip", "glowing blue crystal staff", "heavy plate armor with gold trim"'
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              disabled={isGenerating}
            />
          </div>

          {/* Slot picker */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-2">Slot</label>
            <div className="flex gap-2">
              {SLOTS.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSlot(s.id)}
                  disabled={isGenerating}
                  className={`flex-1 rounded-lg border px-2 py-2 text-xs font-medium transition-colors ${
                    slot === s.id
                      ? "border-accent bg-accent text-white"
                      : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Generate */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !description.trim()}
            className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating ? "Generating item…" : "Generate Item"}
          </button>

          {genError && <p className="text-sm text-red-500">{genError}</p>}
        </div>

        {/* Library */}
        <div className="mt-12 w-full max-w-2xl">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">
            Item Library ({savedItems.length})
          </h2>

          {savedItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">No items saved yet. Generate one above!</p>
          ) : (
            <div className="grid grid-cols-4 gap-4">
              {savedItems.map((item) => (
                <ItemCard key={item.id} item={item} onDelete={() => handleDelete(item.id)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setModalImage(null)}
        >
          <div
            className="relative flex flex-col items-center rounded-2xl bg-white px-10 py-8 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setModalImage(null)}
              className="absolute right-4 top-4 text-gray-400 hover:text-gray-600 text-lg leading-none"
            >
              ✕
            </button>

            {/* Name */}
            <p className="mb-6 text-2xl font-ahsing text-foreground">{modalName}</p>

            {/* Sprite */}
            <div className="rounded-xl bg-white border border-gray-200 p-6 shadow-inner">
              <img
                src={modalImage}
                alt={modalName}
                style={{ display: "block", width: 192, height: 192, imageRendering: "pixelated" }}
              />
            </div>

            {/* Slot badge */}
            <span className="mt-4 rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500 capitalize">
              {modalSlot}
            </span>

            {/* Save */}
            <button
              onClick={handleSave}
              disabled={saveStatus === "saving" || saveStatus === "saved"}
              className="mt-6 rounded-lg bg-green-600 px-8 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
            >
              {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "Saved!" : "Save to Library"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, onDelete }: { item: SavedItem; onDelete: () => void }) {
  return (
    <div className="group relative flex flex-col items-center rounded-lg border border-gray-200 bg-white p-3">
      <img
        src={item.imageBase64}
        alt={item.name}
        className="block rounded"
        style={{ width: 64, height: 64, imageRendering: "pixelated" }}
      />
      <p className="mt-2 w-full truncate text-center text-xs font-ahsing text-gray-700">{item.name}</p>
      <span className="mt-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-400 capitalize">
        {item.slot}
      </span>

      {/* Delete — visible on hover */}
      <button
        onClick={onDelete}
        className="absolute right-1.5 top-1.5 hidden rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-100 hover:text-red-600 group-hover:block"
      >
        ✕
      </button>
    </div>
  );
}
