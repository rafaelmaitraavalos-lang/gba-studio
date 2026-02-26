"use client";

import { useEffect, useState, useCallback } from "react";
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

const WALLS = ["north", "south", "east", "west"] as const;
type Wall = (typeof WALLS)[number];

interface DoorConfig {
  wall: Wall;
  label: string;
}

interface GeneratedRoom {
  grid: string[][];
  doors: { wall: string; x: number; label: string }[];
  image: string | null;
  enhancedPrompt: string;
}

interface SavedRoom {
  id: string;
  name: string;
  description: string;
  imageUrl: string;
  grid: string[][];
  doors: { wall: string; x: number; label: string }[];
}

export default function RoomGenerator() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  const [roomName, setRoomName] = useState("");
  const [description, setDescription] = useState("");
  const [doors, setDoors] = useState<DoorConfig[]>([]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState<GeneratedRoom | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [savedRooms, setSavedRooms] = useState<SavedRoom[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load saved rooms
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(
      collection(db, "users", user.uid, "projects", projectId, "rooms")
    ).then((snapshot) => {
      const items: SavedRoom[] = [];
      snapshot.forEach((d) => {
        const data = d.data();
        items.push({
          id: d.id,
          name: (data.name as string) ?? "Room",
          description: (data.description as string) ?? "",
          imageUrl: (data.imageBase64 as string) ?? "",
          grid: data.gridJson ? (JSON.parse(data.gridJson as string) as string[][]) : [],
          doors: (data.doors as { wall: string; x: number; label: string }[]) ?? [],
        });
      });
      setSavedRooms(items);
    });
  }, [user, projectId]);

  // Door management
  const addDoor = useCallback(() => {
    if (doors.length >= 4) return;
    const usedWalls = new Set(doors.map((d) => d.wall));
    const nextWall = WALLS.find((w) => !usedWalls.has(w)) ?? "north";
    setDoors((prev) => [...prev, { wall: nextWall, label: "" }]);
  }, [doors]);

  const removeDoor = useCallback((idx: number) => {
    setDoors((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateDoor = useCallback((idx: number, field: "wall" | "label", value: string) => {
    setDoors((prev) =>
      prev.map((d, i) => (i === idx ? { ...d, [field]: value } : d))
    );
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    setGenerated(null);
    try {
      const res = await fetch("/api/generate-room", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roomName.trim() || "Untitled Room",
          description: description.trim(),
          doors,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setGenError(data.error ?? "Generation failed");
        return;
      }
      setGenerated(data);
    } catch {
      setGenError("Failed to generate room");
    } finally {
      setIsGenerating(false);
    }
  }, [roomName, description, doors, isGenerating]);

  const handleSave = useCallback(async () => {
    if (!user || !generated) return;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const name = roomName.trim() || "Untitled Room";
      const docRef = await addDoc(
        collection(db, "users", user.uid, "projects", projectId, "rooms"),
        {
          name,
          description: description.trim(),
          imageBase64: generated.image ?? "",
          gridJson: JSON.stringify(generated.grid),
          doors: generated.doors,
          createdAt: serverTimestamp(),
        }
      );
      setSavedRooms((prev) => [
        ...prev,
        {
          id: docRef.id,
          name,
          description: description.trim(),
          imageUrl: generated.image ?? "",
          grid: generated.grid,
          doors: generated.doors,
        },
      ]);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, generated, roomName, description]);

  const handleDelete = useCallback(
    async (roomId: string) => {
      if (!user || !window.confirm("Delete this room?")) return;
      try {
        const db = getFirebaseDb();
        await deleteDoc(
          doc(db, "users", user.uid, "projects", projectId, "rooms", roomId)
        );
        setSavedRooms((prev) => prev.filter((r) => r.id !== roomId));
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
          Room Generator
        </h1>

        {/* Generator controls */}
        <div className="w-full max-w-md space-y-4">
          {/* Room name */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Room Name
            </label>
            <input
              type="text"
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder="e.g. Dungeon Cell, Throne Room"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isGenerating}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder='e.g. "dark stone dungeon cell with a torch on the wall and a chest in the corner"'
              rows={3}
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              disabled={isGenerating}
            />
          </div>

          {/* Door configuration */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-gray-500">
                Doors ({doors.length}/4)
              </label>
              {doors.length < 4 && (
                <button
                  onClick={addDoor}
                  disabled={isGenerating}
                  className="text-xs font-medium text-accent hover:text-blue-700 disabled:opacity-50"
                >
                  + Add Door
                </button>
              )}
            </div>

            {doors.length === 0 && (
              <p className="text-xs text-gray-400 py-2">
                No doors added. Click &quot;+ Add Door&quot; to connect rooms.
              </p>
            )}

            <div className="space-y-2">
              {doors.map((door, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-2 rounded border border-gray-200 bg-white p-2"
                >
                  <select
                    value={door.wall}
                    onChange={(e) => updateDoor(idx, "wall", e.target.value)}
                    disabled={isGenerating}
                    className="rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                  >
                    {WALLS.map((w) => (
                      <option key={w} value={w}>
                        {w.charAt(0).toUpperCase() + w.slice(1)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={door.label}
                    onChange={(e) => updateDoor(idx, "label", e.target.value)}
                    placeholder="Destination (e.g. Throne Room)"
                    disabled={isGenerating}
                    className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <button
                    onClick={() => removeDoor(idx)}
                    disabled={isGenerating}
                    className="text-sm text-red-400 hover:text-red-600 px-1"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Generate button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !description.trim()}
            className="w-full rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isGenerating ? "Generating room..." : "Generate Room"}
          </button>

          {genError && (
            <p className="text-sm text-red-500">{genError}</p>
          )}
        </div>

        {/* Preview */}
        {generated && (
          <div className="mt-6 flex flex-col items-center space-y-3">
            {generated.image ? (
              <img
                src={generated.image}
                alt="Generated room"
                className="pixelated rounded border border-gray-300"
                style={{ width: 480, height: 320, imageRendering: "pixelated" }}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded border border-gray-300 bg-gray-100 text-gray-400 text-sm"
                style={{ width: 480, height: 320 }}
              >
                Image generation failed — grid data saved
              </div>
            )}

            {/* Tile grid mini-preview */}
            <div className="flex flex-col items-center">
              <span className="mb-1 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Tile Grid
              </span>
              <TileGridPreview grid={generated.grid} />
            </div>

            <button
              onClick={handleSave}
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

        {/* Room library */}
        <div className="mt-10 w-full max-w-2xl">
          <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">
            Room Library ({savedRooms.length})
          </h2>

          {savedRooms.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">
              No rooms saved yet. Generate one above!
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-4">
              {savedRooms.map((room) => (
                <RoomCard
                  key={room.id}
                  room={room}
                  onDelete={() => handleDelete(room.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const TILE_COLORS: Record<string, string> = {
  W: "#4a4a5a",
  F: "#8a7a6a",
  D: "#6ab04c",
  C: "#f9ca24",
  T: "#eb4d4b",
  B: "#7b5e3b",
  S: "#a0a0b0",
};

function TileGridPreview({ grid }: { grid: string[][] }) {
  if (!grid || grid.length === 0) return null;
  const cellSize = 6;
  const rows = grid.length;
  const cols = grid[0].length;

  return (
    <div
      className="rounded border border-gray-300 overflow-hidden"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`,
        gridTemplateRows: `repeat(${rows}, ${cellSize}px)`,
      }}
    >
      {grid.flatMap((row, r) =>
        row.map((tile, c) => (
          <div
            key={`${r}-${c}`}
            style={{
              width: cellSize,
              height: cellSize,
              backgroundColor: TILE_COLORS[tile] ?? "#555",
            }}
          />
        ))
      )}
    </div>
  );
}

function RoomCard({
  room,
  onDelete,
}: {
  room: SavedRoom;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-gray-200 bg-white p-3">
      {room.imageUrl ? (
        <img
          src={room.imageUrl}
          alt={room.name}
          className="pixelated block rounded"
          style={{ width: 160, height: 107, imageRendering: "pixelated" }}
        />
      ) : room.grid && room.grid.length > 0 ? (
        <TileGridPreview grid={room.grid} />
      ) : (
        <div
          className="flex items-center justify-center rounded bg-gray-100 text-gray-300 text-xs"
          style={{ width: 160, height: 107 }}
        >
          ?
        </div>
      )}
      <p className="mt-2 text-sm text-gray-700 truncate w-full text-center font-ahsing">
        {room.name}
      </p>
      {room.doors.length > 0 && (
        <span className="text-[10px] text-gray-400">
          {room.doors.length} door{room.doors.length > 1 ? "s" : ""}
        </span>
      )}
      <button
        onClick={onDelete}
        className="mt-1 text-[10px] text-red-400 hover:text-red-600"
      >
        Delete
      </button>
    </div>
  );
}
