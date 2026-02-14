"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { TILE_TYPES, type TileType } from "@/lib/tiles";
import {
  type RoomData,
  type RoomType,
  type ObjectInstance,
  loadRooms,
  createRoom,
  saveRoom,
  deleteRoom,
  tilesToGrid,
  gridToTiles,
} from "@/lib/rooms";
import {
  OBJECT_TYPES,
  type ObjectType,
  getDefaultProperties,
  getObjectTypeDef,
} from "@/lib/objects";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";

const TILE_SIZE = 32;
const DEPTH_HEIGHT = 6;

type ActiveLayer = "tiles" | "objects" | "playerStart";

function getTileDef(id: string): TileType | undefined {
  return TILE_TYPES.find((t) => t.id === id);
}

let nextObjId = 1;
function genObjId() {
  return `obj_${Date.now()}_${nextObjId++}`;
}

export default function RoomBuilder() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isPaintingRef = useRef(false);

  const [rooms, setRooms] = useState<RoomData[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [selectedTile, setSelectedTile] = useState<string | null>("grass");
  const [activeLayer, setActiveLayer] = useState<ActiveLayer>("tiles");
  const [selectedObjectType, setSelectedObjectType] = useState<ObjectType>("chest");
  const [editingObject, setEditingObject] = useState<ObjectInstance | null>(null);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [showNewRoomForm, setShowNewRoomForm] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomType, setNewRoomType] = useState<RoomType>("room");
  const [editingRoomName, setEditingRoomName] = useState<string | null>(null);
  const [deletingRoomId, setDeletingRoomId] = useState<string | null>(null);
  const [roomsLoaded, setRoomsLoaded] = useState(false);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;
  const cols = activeRoom?.cols ?? 16;
  const rows = activeRoom?.rows ?? 10;
  const canvasWidth = cols * TILE_SIZE;
  const canvasHeight = rows * TILE_SIZE;

  // Auth gate
  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load rooms
  useEffect(() => {
    if (!user || !projectId) return;
    loadRooms(user.uid, projectId).then(async (loaded) => {
      if (loaded.length === 0) {
        const firstRoom = await createRoom(user.uid, projectId, "Room 1", "room");
        setRooms([firstRoom]);
        setActiveRoomId(firstRoom.id);
      } else {
        setRooms(loaded);
        setActiveRoomId(loaded[0].id);
      }
      setRoomsLoaded(true);
    });
  }, [user, projectId]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !activeRoom) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const grid = tilesToGrid(activeRoom.tiles, activeRoom.cols, activeRoom.rows);

    // Draw tiles
    for (let row = 0; row < activeRoom.rows; row++) {
      for (let col = 0; col < activeRoom.cols; col++) {
        const x = col * TILE_SIZE;
        const y = row * TILE_SIZE;
        const tileId = grid[row]?.[col];

        if (tileId) {
          const def = getTileDef(tileId);
          if (def) {
            if (def.depthColor) {
              ctx.fillStyle = def.color;
              ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE - DEPTH_HEIGHT);
              ctx.fillStyle = def.depthColor;
              ctx.fillRect(x, y + TILE_SIZE - DEPTH_HEIGHT, TILE_SIZE, DEPTH_HEIGHT);
            } else {
              ctx.fillStyle = def.color;
              ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
            }
          }
        } else {
          ctx.fillStyle = (row + col) % 2 === 0 ? "#F5F5F5" : "#EBEBEB";
          ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
        }
      }
    }

    // Draw objects
    for (const obj of activeRoom.objects) {
      const def = getObjectTypeDef(obj.type);
      if (!def) continue;
      const x = obj.col * TILE_SIZE;
      const y = obj.row * TILE_SIZE;
      ctx.fillStyle = def.color;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(def.icon, x + TILE_SIZE / 2, y + TILE_SIZE / 2);
    }

    // Draw player start
    if (activeRoom.playerStart) {
      const px = activeRoom.playerStart.col * TILE_SIZE;
      const py = activeRoom.playerStart.row * TILE_SIZE;
      ctx.fillStyle = "#22C55E";
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.arc(px + TILE_SIZE / 2, py + TILE_SIZE / 2, TILE_SIZE / 2 - 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#FFFFFF";
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("P", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
    }

    // Grid lines
    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    ctx.lineWidth = 1;
    for (let c = 0; c <= activeRoom.cols; c++) {
      const x = c * TILE_SIZE + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvasHeight);
      ctx.stroke();
    }
    for (let r = 0; r <= activeRoom.rows; r++) {
      const y = r * TILE_SIZE + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasWidth, y);
      ctx.stroke();
    }
  }, [activeRoom, canvasWidth, canvasHeight]);

  const getGridPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || !activeRoom) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;
      const col = Math.floor((e.clientX - rect.left) * scaleX / TILE_SIZE);
      const row = Math.floor((e.clientY - rect.top) * scaleY / TILE_SIZE);
      if (col < 0 || col >= activeRoom.cols || row < 0 || row >= activeRoom.rows) return null;
      return { row, col };
    },
    [activeRoom, canvasWidth, canvasHeight]
  );

  const updateActiveRoom = useCallback(
    (updater: (room: RoomData) => RoomData) => {
      setRooms((prev) =>
        prev.map((r) => (r.id === activeRoomId ? updater(r) : r))
      );
    },
    [activeRoomId]
  );

  const paintTile = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const pos = getGridPos(e);
      if (!pos || !activeRoom) return;

      if (activeLayer === "tiles") {
        const grid = tilesToGrid(activeRoom.tiles, activeRoom.cols, activeRoom.rows);
        if (grid[pos.row][pos.col] === selectedTile) return;
        const newGrid = grid.map((r) => [...r]);
        newGrid[pos.row][pos.col] = selectedTile;
        updateActiveRoom((room) => ({
          ...room,
          tiles: gridToTiles(newGrid, room.cols, room.rows),
        }));
      } else if (activeLayer === "objects") {
        // Check if object exists at this position
        const existing = activeRoom.objects.find(
          (o) => o.row === pos.row && o.col === pos.col
        );
        if (existing) {
          if (selectedObjectType === null as unknown) {
            // Eraser mode — remove object
            updateActiveRoom((room) => ({
              ...room,
              objects: room.objects.filter((o) => o.id !== existing.id),
            }));
          } else {
            setEditingObject(existing);
          }
        } else if (selectedObjectType) {
          const newObj: ObjectInstance = {
            id: genObjId(),
            type: selectedObjectType,
            row: pos.row,
            col: pos.col,
            properties: getDefaultProperties(selectedObjectType),
          };
          updateActiveRoom((room) => ({
            ...room,
            objects: [...room.objects, newObj],
          }));
        }
      } else if (activeLayer === "playerStart") {
        updateActiveRoom((room) => ({
          ...room,
          playerStart: { row: pos.row, col: pos.col },
        }));
      }
    },
    [getGridPos, activeRoom, activeLayer, selectedTile, selectedObjectType, updateActiveRoom]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (activeLayer === "tiles") isPaintingRef.current = true;
      paintTile(e);
    },
    [paintTile, activeLayer]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!isPaintingRef.current) return;
      paintTile(e);
    },
    [paintTile]
  );

  const stopPainting = useCallback(() => {
    isPaintingRef.current = false;
  }, []);

  const handleSave = useCallback(async () => {
    if (!user || !activeRoom) return;
    setSaveStatus("saving");
    try {
      // Save all rooms
      for (const room of rooms) {
        await saveRoom(user.uid, projectId, room);
      }
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Save failed:", err);
      setSaveStatus("idle");
    }
  }, [user, projectId, rooms, activeRoom]);

  const handleCreateRoom = useCallback(async () => {
    if (!user || !newRoomName.trim()) return;
    const room = await createRoom(user.uid, projectId, newRoomName.trim(), newRoomType);
    setRooms((prev) => [...prev, room]);
    setActiveRoomId(room.id);
    setShowNewRoomForm(false);
    setNewRoomName("");
    setNewRoomType("room");
  }, [user, projectId, newRoomName, newRoomType]);

  const handleDeleteRoom = useCallback(
    async (roomId: string) => {
      if (!user) return;
      await deleteRoom(user.uid, projectId, roomId);
      setRooms((prev) => {
        const next = prev.filter((r) => r.id !== roomId);
        if (activeRoomId === roomId && next.length > 0) {
          setActiveRoomId(next[0].id);
        }
        return next;
      });
      setDeletingRoomId(null);
    },
    [user, projectId, activeRoomId]
  );

  const handleRenameRoom = useCallback(
    (roomId: string, newName: string) => {
      if (!newName.trim()) return;
      setRooms((prev) =>
        prev.map((r) => (r.id === roomId ? { ...r, name: newName.trim() } : r))
      );
      setEditingRoomName(null);
    },
    []
  );

  const handleRemoveObject = useCallback(() => {
    if (!editingObject || !activeRoom) return;
    updateActiveRoom((room) => ({
      ...room,
      objects: room.objects.filter((o) => o.id !== editingObject.id),
    }));
    setEditingObject(null);
  }, [editingObject, activeRoom, updateActiveRoom]);

  const handleUpdateObjectProp = useCallback(
    (key: string, value: unknown) => {
      if (!editingObject) return;
      const updatedObj = {
        ...editingObject,
        properties: { ...editingObject.properties, [key]: value },
      };
      setEditingObject(updatedObj);
      updateActiveRoom((room) => ({
        ...room,
        objects: room.objects.map((o) => (o.id === updatedObj.id ? updatedObj : o)),
      }));
    },
    [editingObject, updateActiveRoom]
  );

  if (loading || !user || !roomsLoaded) {
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
        {/* Sidebar */}
        <aside className="w-[220px] shrink-0 overflow-y-auto border-r border-gray-200 p-4">
          {/* Room list */}
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Rooms
          </h2>
          <div className="flex flex-col gap-1">
            {rooms.map((room) => (
              <div key={room.id} className="group relative">
                {deletingRoomId === room.id ? (
                  <div className="flex items-center gap-1 rounded-lg bg-red-50 px-2 py-1.5">
                    <span className="text-xs text-red-600">Delete?</span>
                    <button
                      onClick={() => handleDeleteRoom(room.id)}
                      className="ml-auto text-xs font-semibold text-red-600 hover:text-red-800"
                    >
                      Yes
                    </button>
                    <button
                      onClick={() => setDeletingRoomId(null)}
                      className="text-xs text-gray-500 hover:text-gray-700"
                    >
                      No
                    </button>
                  </div>
                ) : editingRoomName === room.id ? (
                  <input
                    autoFocus
                    defaultValue={room.name}
                    className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleRenameRoom(room.id, (e.target as HTMLInputElement).value);
                      if (e.key === "Escape") setEditingRoomName(null);
                    }}
                    onBlur={(e) => handleRenameRoom(room.id, e.target.value)}
                  />
                ) : (
                  <button
                    onClick={() => setActiveRoomId(room.id)}
                    onDoubleClick={() => setEditingRoomName(room.id)}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-sm transition-all ${
                      activeRoomId === room.id
                        ? "ring-2 ring-accent bg-blue-50 font-medium"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <span className="truncate">
                      {room.name}
                      <span className="ml-1 text-xs text-gray-400">
                        ({room.type === "hallway" ? "H" : "R"})
                      </span>
                    </span>
                    {rooms.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeletingRoomId(room.id);
                        }}
                        className="hidden text-gray-400 hover:text-red-500 group-hover:block"
                      >
                        &times;
                      </button>
                    )}
                  </button>
                )}
              </div>
            ))}
          </div>

          {showNewRoomForm ? (
            <div className="mt-2 rounded-lg border border-gray-200 bg-white p-2">
              <input
                autoFocus
                placeholder="Room name"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateRoom();
                  if (e.key === "Escape") setShowNewRoomForm(false);
                }}
              />
              <div className="mt-2 flex gap-1">
                <button
                  onClick={() => setNewRoomType("room")}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                    newRoomType === "room"
                      ? "bg-accent text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  Room
                </button>
                <button
                  onClick={() => setNewRoomType("hallway")}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium ${
                    newRoomType === "hallway"
                      ? "bg-accent text-white"
                      : "bg-gray-100 text-gray-600"
                  }`}
                >
                  Hallway
                </button>
              </div>
              <div className="mt-2 flex gap-1">
                <button
                  onClick={handleCreateRoom}
                  className="flex-1 rounded bg-accent px-2 py-1 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  Create
                </button>
                <button
                  onClick={() => setShowNewRoomForm(false)}
                  className="rounded px-2 py-1 text-xs text-gray-500 hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowNewRoomForm(true)}
              className="mt-2 w-full rounded-lg border border-dashed border-gray-300 px-2 py-1.5 text-sm text-gray-500 hover:border-accent hover:text-accent"
            >
              + New Room
            </button>
          )}

          <hr className="my-4 border-gray-200" />

          {/* Layer toggle */}
          <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
            Layer
          </h2>
          <div className="flex flex-col gap-1">
            {(["tiles", "objects", "playerStart"] as ActiveLayer[]).map((layer) => (
              <button
                key={layer}
                onClick={() => {
                  setActiveLayer(layer);
                  setEditingObject(null);
                }}
                className={`rounded-lg px-2 py-1.5 text-left text-sm transition-all ${
                  activeLayer === layer
                    ? "ring-2 ring-accent bg-blue-50 font-medium"
                    : "hover:bg-gray-50"
                }`}
              >
                {layer === "tiles" ? "Tiles" : layer === "objects" ? "Objects" : "Player Start"}
              </button>
            ))}
          </div>

          <hr className="my-4 border-gray-200" />

          {/* Layer-specific palette */}
          {activeLayer === "tiles" && (
            <>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
                Tiles
              </h2>
              <div className="flex flex-col gap-2">
                {TILE_TYPES.map((tile) => (
                  <button
                    key={tile.id}
                    onClick={() => setSelectedTile(tile.id)}
                    className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-all ${
                      selectedTile === tile.id
                        ? "ring-2 ring-accent bg-blue-50"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className="block h-8 w-8 shrink-0 rounded"
                      style={{ backgroundColor: tile.color }}
                    />
                    <span>{tile.label}</span>
                  </button>
                ))}
              </div>
              <hr className="my-4 border-gray-200" />
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
                Tools
              </h2>
              <button
                onClick={() => setSelectedTile(null)}
                className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-all ${
                  selectedTile === null
                    ? "ring-2 ring-accent bg-blue-50"
                    : "hover:bg-gray-50"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-200 text-base">
                  &#x2715;
                </span>
                <span>Eraser</span>
              </button>
            </>
          )}

          {activeLayer === "objects" && (
            <>
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-400">
                Objects
              </h2>
              <div className="flex flex-col gap-2">
                {OBJECT_TYPES.map((obj) => (
                  <button
                    key={obj.type}
                    onClick={() => setSelectedObjectType(obj.type)}
                    className={`flex items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm transition-all ${
                      selectedObjectType === obj.type
                        ? "ring-2 ring-accent bg-blue-50"
                        : "hover:bg-gray-50"
                    }`}
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm font-bold text-white"
                      style={{ backgroundColor: obj.color }}
                    >
                      {obj.icon}
                    </span>
                    <span>{obj.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {activeLayer === "playerStart" && (
            <p className="text-sm text-gray-500">
              Click a tile to set the player start position for this room.
            </p>
          )}
        </aside>

        {/* Canvas area */}
        <main className="flex flex-1 items-center justify-center bg-gray-50 p-8">
          {activeRoom && (
            <canvas
              ref={canvasRef}
              width={canvasWidth}
              height={canvasHeight}
              className="pixelated border border-gray-300"
              style={{ cursor: "crosshair" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={stopPainting}
              onMouseLeave={stopPainting}
            />
          )}
        </main>

        {/* Right panel: Object properties */}
        {editingObject && (
          <aside className="w-[250px] shrink-0 border-l border-gray-200 p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">
                Properties
              </h2>
              <button
                onClick={() => setEditingObject(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            </div>
            <p className="mb-3 text-sm font-medium capitalize">
              {editingObject.type}
            </p>

            {editingObject.type === "door" && (
              <label className="block text-sm">
                <span className="text-gray-600">Target Room</span>
                <select
                  value={(editingObject.properties.targetRoomId as string) ?? ""}
                  onChange={(e) => handleUpdateObjectProp("targetRoomId", e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">-- None --</option>
                  {rooms
                    .filter((r) => r.id !== activeRoomId)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                </select>
              </label>
            )}

            {editingObject.type === "chest" && (
              <label className="block text-sm">
                <span className="text-gray-600">Item</span>
                <input
                  type="text"
                  value={(editingObject.properties.item as string) ?? ""}
                  onChange={(e) => handleUpdateObjectProp("item", e.target.value)}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            )}

            {editingObject.type === "npc" && (
              <label className="block text-sm">
                <span className="text-gray-600">Dialogue</span>
                <textarea
                  value={(editingObject.properties.dialogue as string) ?? ""}
                  onChange={(e) => handleUpdateObjectProp("dialogue", e.target.value)}
                  rows={3}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            )}

            {editingObject.type === "enemy" && (
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-gray-600">HP</span>
                  <input
                    type="number"
                    value={(editingObject.properties.hp as number) ?? 10}
                    onChange={(e) => handleUpdateObjectProp("hp", Number(e.target.value))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-gray-600">Damage</span>
                  <input
                    type="number"
                    value={(editingObject.properties.damage as number) ?? 2}
                    onChange={(e) => handleUpdateObjectProp("damage", Number(e.target.value))}
                    className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </label>
              </div>
            )}

            {editingObject.type === "sign" && (
              <label className="block text-sm">
                <span className="text-gray-600">Text</span>
                <textarea
                  value={(editingObject.properties.text as string) ?? ""}
                  onChange={(e) => handleUpdateObjectProp("text", e.target.value)}
                  rows={3}
                  className="mt-1 block w-full rounded border border-gray-300 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </label>
            )}

            <button
              onClick={handleRemoveObject}
              className="mt-4 w-full rounded-lg bg-red-50 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-100"
            >
              Remove Object
            </button>
          </aside>
        )}
      </div>
    </div>
  );
}
