"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import {
  addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp,
} from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";

type DialogueStyle = "rpg_banner" | "speech_bubble" | "parchment" | "typewriter" | "chat_box";

interface SavedNPC {
  id: string;
  name: string;
  description: string;
  spritesheet: string;
  isWalking: boolean;
  dialogue: string[];
  dialogueStyle: DialogueStyle;
}

const STYLE_OPTIONS: { id: DialogueStyle; label: string }[] = [
  { id: "rpg_banner",     label: "Classic RPG Banner" },
  { id: "speech_bubble",  label: "Floating Speech Bubble" },
  { id: "parchment",      label: "Parchment Scroll" },
  { id: "typewriter",     label: "Typewriter" },
  { id: "chat_box",       label: "Modern Chat Box" },
];

// ─── Dialogue Style Thumbnail ─────────────────────────────────────────────────

function DialogueStylePreview({ styleId }: { styleId: DialogueStyle }) {
  if (styleId === "rpg_banner") return (
    <div style={{ width: 96, height: 56 }} className="relative bg-sky-100 rounded overflow-hidden">
      <div className="absolute bottom-0 left-0 right-0 h-1/2 bg-black flex items-center gap-1 px-1.5">
        <div className="w-6 h-6 rounded-sm bg-gray-600 border border-gray-500 flex-shrink-0" />
        <div className="flex-1 space-y-1">
          <div className="h-1 bg-white/80 rounded w-full" />
          <div className="h-1 bg-white/60 rounded w-3/4" />
        </div>
      </div>
    </div>
  );
  if (styleId === "speech_bubble") return (
    <div style={{ width: 96, height: 56 }} className="bg-sky-100 rounded overflow-hidden flex items-center justify-center pb-2">
      <div className="relative bg-white rounded-xl border border-gray-300 px-2 py-1.5 shadow-sm">
        <div className="space-y-0.5">
          <div className="h-1 bg-gray-300 rounded w-14" />
          <div className="h-1 bg-gray-300 rounded w-10" />
        </div>
        <div className="absolute -bottom-2 left-3 w-0 h-0"
          style={{ borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: "8px solid white" }} />
      </div>
    </div>
  );
  if (styleId === "parchment") return (
    <div style={{ width: 96, height: 56 }} className="flex flex-col bg-amber-50 rounded overflow-hidden">
      <div className="h-3 bg-amber-300 rounded-b-[40%]" />
      <div className="flex-1 flex items-center px-2">
        <div className="space-y-1 w-full">
          <div className="h-1 bg-amber-500/50 rounded w-full" />
          <div className="h-1 bg-amber-500/50 rounded w-4/5" />
        </div>
      </div>
      <div className="h-3 bg-amber-300 rounded-t-[40%]" />
    </div>
  );
  if (styleId === "typewriter") return (
    <div style={{ width: 96, height: 56 }} className="bg-gray-950 rounded overflow-hidden flex items-center justify-center p-2">
      <div className="border border-green-500/50 rounded px-2 py-1.5 w-full">
        <div className="space-y-0.5">
          <div className="h-1 bg-green-400/80 rounded w-4/5" />
          <div className="h-1 bg-green-400/60 rounded w-3/5" />
        </div>
      </div>
    </div>
  );
  return (
    <div style={{ width: 96, height: 56 }} className="bg-gray-100 rounded overflow-hidden flex flex-col justify-end gap-1 p-1.5">
      <div className="bg-white rounded-2xl rounded-bl-sm px-2 py-1 border border-gray-200 self-start">
        <div className="h-1 bg-gray-300 rounded w-12" />
      </div>
      <div className="bg-blue-500 rounded-2xl rounded-br-sm px-2 py-1 self-end">
        <div className="h-1 bg-white/70 rounded w-10" />
      </div>
    </div>
  );
}

// ─── Dialogue Live Preview ────────────────────────────────────────────────────

function DialogueLivePreview({ styleId, text, npcName }: { styleId: DialogueStyle; text: string; npcName: string }) {
  if (styleId === "rpg_banner") return (
    <div className="w-full rounded-xl overflow-hidden border border-gray-700">
      <div className="bg-black flex items-center gap-3 px-4 py-3">
        <div className="w-12 h-12 rounded border border-gray-600 bg-gray-800 flex-shrink-0 flex items-center justify-center text-gray-400 text-sm font-ahsing">
          {npcName.charAt(0)}
        </div>
        <div>
          <p className="text-yellow-400 text-xs font-ahsing mb-1">{npcName}</p>
          <p className="text-white text-sm leading-relaxed">{text}</p>
        </div>
      </div>
    </div>
  );
  if (styleId === "speech_bubble") return (
    <div className="w-full rounded-xl bg-sky-50 border border-sky-200 py-8 flex justify-center">
      <div className="relative bg-white rounded-2xl border border-gray-200 shadow-md px-5 py-3 max-w-sm">
        <p className="text-xs font-ahsing text-blue-600 mb-1">{npcName}</p>
        <p className="text-sm text-gray-700">{text}</p>
        <div className="absolute -bottom-3 left-6 w-0 h-0"
          style={{ borderLeft: "6px solid transparent", borderRight: "6px solid transparent", borderTop: "12px solid white" }} />
      </div>
    </div>
  );
  if (styleId === "parchment") return (
    <div className="w-full rounded-xl overflow-hidden border border-amber-300">
      <div className="h-5 bg-amber-300 rounded-b-[60%]" />
      <div className="bg-amber-50 px-6 py-4">
        <p className="text-center text-xs font-ahsing text-amber-800 mb-2 tracking-widest uppercase">{npcName}</p>
        <p className="text-center text-sm text-amber-900 italic">{text}</p>
      </div>
      <div className="h-5 bg-amber-300 rounded-t-[60%]" />
    </div>
  );
  if (styleId === "typewriter") return (
    <div className="w-full rounded-xl bg-gray-950 border border-green-500/30 px-5 py-4 font-mono">
      <p className="text-green-500/60 text-xs mb-1">{npcName.toUpperCase()}&gt;</p>
      <p className="text-green-400 text-sm">{text}<span className="animate-pulse">▌</span></p>
    </div>
  );
  return (
    <div className="w-full rounded-xl bg-gray-100 border border-gray-200 px-4 py-4 flex flex-col gap-2">
      <div className="flex items-end gap-2">
        <div className="w-8 h-8 rounded-full bg-gray-400 flex-shrink-0 flex items-center justify-center text-white text-xs font-ahsing">
          {npcName.charAt(0)}
        </div>
        <div className="bg-white rounded-2xl rounded-bl-sm px-4 py-2 border border-gray-200 shadow-sm max-w-xs">
          <p className="text-[10px] font-ahsing text-gray-400 mb-0.5">{npcName}</p>
          <p className="text-sm text-gray-700">{text}</p>
        </div>
      </div>
    </div>
  );
}

// ─── NPC Library Card ─────────────────────────────────────────────────────────

function NPCCard({ npc, onDelete }: { npc: SavedNPC; onDelete: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const lastTickRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !npc.spritesheet) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; };
    img.src = npc.spritesheet;

    function animate(ts: number) {
      if (!ctx || !canvas) return;
      if (ts - lastTickRef.current >= 200) {
        frameRef.current = (frameRef.current + 1) % (npc.isWalking ? 4 : 2);
        lastTickRef.current = ts;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const sheet = imgRef.current;
      if (sheet && sheet.complete && sheet.naturalWidth > 0) {
        const fw = sheet.width / 4;
        const fh = sheet.height / 4;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sheet, frameRef.current * fw, 2 * fh, fw, fh, 0, 0, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(animate);
    }
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [npc.spritesheet, npc.isWalking]);

  const styleLabel = STYLE_OPTIONS.find(s => s.id === npc.dialogueStyle)?.label ?? npc.dialogueStyle;

  return (
    <div className="flex flex-col items-center rounded-xl border border-gray-200 bg-white p-3 shadow-sm hover:shadow-md transition-shadow">
      <canvas ref={canvasRef} width={64} height={64} className="rounded"
        style={{ imageRendering: "pixelated", width: 64, height: 64 }} />
      <p className="mt-2 text-sm text-gray-800 truncate w-full text-center font-ahsing">{npc.name}</p>
      <p className="text-[9px] text-gray-400 mt-0.5 text-center">{npc.isWalking ? "Walk" : "Idle"} · {styleLabel}</p>
      {npc.dialogue.length > 0 && (
        <p className="mt-1 text-[9px] text-gray-400 truncate w-full text-center italic">"{npc.dialogue[0]}"</p>
      )}
      <button onClick={onDelete} className="mt-2 text-[10px] text-red-400 hover:text-red-600">Delete</button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function NPCGenerator() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  const [npcName, setNpcName] = useState("");
  const [description, setDescription] = useState("");
  const [isWalking, setIsWalking] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [spritesheet, setSpritesheet] = useState<string | null>(null);
  const [genError, setGenError] = useState<string | null>(null);

  const [dialogueMode, setDialogueMode] = useState<"ai" | "manual">("ai");
  const [personality, setPersonality] = useState("");
  const [manualDialogue, setManualDialogue] = useState("");
  const [dialogue, setDialogue] = useState<string[]>([]);
  const [isGeneratingDialogue, setIsGeneratingDialogue] = useState(false);
  const [dialogueStyle, setDialogueStyle] = useState<DialogueStyle>("rpg_banner");

  const [savedNPCs, setSavedNPCs] = useState<SavedNPC[]>([]);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const frameRef = useRef(0);
  const dirRef = useRef(2);
  const dirTickRef = useRef(0);
  const lastTickRef = useRef(0);
  const sheetImgRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "npcs")).then((snap) => {
      setSavedNPCs(snap.docs.map((d) => ({
        id: d.id,
        name: (d.data().name as string) ?? "NPC",
        description: (d.data().description as string) ?? "",
        spritesheet: (d.data().spritesheet as string) ?? "",
        isWalking: (d.data().isWalking as boolean) ?? true,
        dialogue: (d.data().dialogue as string[]) ?? [],
        dialogueStyle: (d.data().dialogueStyle as DialogueStyle) ?? "rpg_banner",
      })));
    });
  }, [user, projectId]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !spritesheet) { cancelAnimationFrame(rafRef.current); return; }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => { sheetImgRef.current = img; };
    img.src = spritesheet;
    sheetImgRef.current = null;
    frameRef.current = 0;
    dirRef.current = 2;
    dirTickRef.current = 0;

    function animate(ts: number) {
      if (!ctx || !canvas) return;
      if (ts - lastTickRef.current >= 200) {
        frameRef.current = (frameRef.current + 1) % (isWalking ? 4 : 2);
        lastTickRef.current = ts;
        if (isWalking) {
          dirTickRef.current++;
          if (dirTickRef.current >= 8) {
            dirRef.current = (dirRef.current + 1) % 4;
            dirTickRef.current = 0;
          }
        }
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const sheet = sheetImgRef.current;
      if (sheet && sheet.complete && sheet.naturalWidth > 0) {
        const fw = sheet.width / 4;
        const fh = sheet.height / 4;
        const row = isWalking ? dirRef.current : 2;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(sheet, frameRef.current * fw, row * fh, fw, fh, 0, 0, canvas.width, canvas.height);
      }
      rafRef.current = requestAnimationFrame(animate);
    }
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [spritesheet, isWalking]);

  const handleGenerate = useCallback(async () => {
    if (!description.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    setSpritesheet(null);
    try {
      const res = await fetch("/api/generate-mob", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: npcName.trim() || "NPC",
          description: description.trim() + (isWalking ? ", friendly NPC character" : ", idle standing NPC character"),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setGenError(data.error ?? "Generation failed"); return; }
      setSpritesheet(data.spritesheet ?? null);
      if (!data.spritesheet) setGenError("No spritesheet returned");
    } catch { setGenError("Failed to generate NPC"); }
    finally { setIsGenerating(false); }
  }, [npcName, description, isWalking, isGenerating]);

  const handleGenerateDialogue = useCallback(async () => {
    if (!personality.trim() || isGeneratingDialogue) return;
    setIsGeneratingDialogue(true);
    try {
      const res = await fetch("/api/generate-npc-dialogue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: npcName.trim() || "NPC", personality: personality.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.lines) setDialogue(data.lines);
    } catch { /* silent */ }
    finally { setIsGeneratingDialogue(false); }
  }, [npcName, personality, isGeneratingDialogue]);

  const handleSave = useCallback(async () => {
    if (!user || !spritesheet) return;
    const finalDialogue = dialogueMode === "manual"
      ? manualDialogue.split("\n").map(l => l.trim()).filter(Boolean)
      : dialogue;
    setSaveStatus("saving");
    try {
      const db = getFirebaseDb();
      const name = npcName.trim() || "Untitled NPC";
      const docRef = await addDoc(
        collection(db, "users", user.uid, "projects", projectId, "npcs"),
        { name, description: description.trim(), spritesheet, isWalking, dialogue: finalDialogue, dialogueStyle, createdAt: serverTimestamp() }
      );
      setSavedNPCs(prev => [...prev, { id: docRef.id, name, description: description.trim(), spritesheet, isWalking, dialogue: finalDialogue, dialogueStyle }]);
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch { setSaveStatus("idle"); }
  }, [user, projectId, spritesheet, npcName, description, isWalking, dialogue, manualDialogue, dialogueMode, dialogueStyle]);

  const handleDelete = useCallback(async (npcId: string) => {
    if (!user || !window.confirm("Delete this NPC?")) return;
    const db = getFirebaseDb();
    await deleteDoc(doc(db, "users", user.uid, "projects", projectId, "npcs", npcId));
    setSavedNPCs(prev => prev.filter(n => n.id !== npcId));
  }, [user, projectId]);

  const previewLine = (dialogueMode === "manual"
    ? manualDialogue.split("\n").filter(Boolean)
    : dialogue)[0] ?? (npcName ? `Hi, I'm ${npcName}!` : "Greetings, traveler!");

  if (loading || !user) return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500">Loading...</p>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <ProjectHubNav projectId={projectId} onSave={() => {}} saveStatus="idle" saveDisabled />

      {/* ── Section 1: Generation ─────────────────────────────────────────── */}
      <div className="border-b border-gray-200 bg-white">
        <div className="max-w-4xl mx-auto px-8 py-8">
          <h1 className="text-3xl font-ahsing text-foreground mb-8">NPC Studio</h1>
          <div className="flex gap-8">

            {/* Sprite preview card */}
            <div className="shrink-0 flex flex-col items-center gap-3">
              <div className="w-44 h-44 rounded-2xl border-2 border-gray-200 bg-gray-50 flex items-center justify-center shadow-inner">
                {spritesheet ? (
                  <canvas ref={previewCanvasRef} width={128} height={128}
                    style={{ imageRendering: "pixelated", width: 128, height: 128 }} />
                ) : (
                  <div className="flex flex-col items-center gap-2 text-gray-300">
                    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                      <rect x="16" y="4" width="16" height="14" rx="3" fill="currentColor" opacity="0.8" />
                      <rect x="14" y="20" width="20" height="14" rx="2" fill="currentColor" opacity="0.7" />
                      <rect x="6" y="20" width="6" height="12" rx="2" fill="currentColor" opacity="0.5" />
                      <rect x="36" y="20" width="6" height="12" rx="2" fill="currentColor" opacity="0.5" />
                      <rect x="16" y="36" width="6" height="8" rx="2" fill="currentColor" opacity="0.6" />
                      <rect x="26" y="36" width="6" height="8" rx="2" fill="currentColor" opacity="0.6" />
                    </svg>
                    <span className="text-xs text-gray-400">No sprite yet</span>
                  </div>
                )}
              </div>
              {spritesheet && (
                <span className="text-xs text-gray-500 font-ahsing">
                  {isWalking ? "● Walk Cycle" : "● Idle"}
                </span>
              )}
            </div>

            {/* Controls */}
            <div className="flex-1 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1.5 font-ahsing tracking-wide">NPC Name</label>
                  <input
                    type="text"
                    value={npcName}
                    onChange={(e) => setNpcName(e.target.value)}
                    placeholder="Village Elder, Blacksmith..."
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-foreground placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent font-ahsing"
                    disabled={isGenerating}
                  />
                </div>
                <div className="flex items-end pb-0.5">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <button
                      type="button"
                      onClick={() => setIsWalking(w => !w)}
                      className={`relative w-11 h-6 rounded-full transition-colors focus:outline-none ${isWalking ? "bg-purple-600" : "bg-gray-300"}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${isWalking ? "translate-x-5" : ""}`} />
                    </button>
                    <span className="text-sm text-gray-700">Walking NPC</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-500 mb-1.5 font-ahsing tracking-wide">Appearance Description</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Old wizard with a white beard, blue robes and a glowing staff..."
                  rows={3}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-foreground placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  disabled={isGenerating}
                />
              </div>

              <div className="flex items-center gap-4">
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || !description.trim()}
                  className="rounded-lg bg-purple-600 px-6 py-2.5 text-sm font-ahsing text-white hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? "Generating NPC..." : "Generate NPC"}
                </button>
                {genError && <p className="text-sm text-red-500">{genError}</p>}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Section 2: Dialogue System ─────────────────────────────────────── */}
      {spritesheet && (
        <div className="border-b border-gray-200 bg-white">
          <div className="max-w-4xl mx-auto px-8 py-8">
            <h2 className="text-2xl font-ahsing text-foreground mb-6">Dialogue</h2>

            <div className="grid grid-cols-2 gap-8">
              {/* Dialogue input */}
              <div className="flex flex-col gap-4">
                <div className="flex gap-1 p-1 bg-gray-100 rounded-lg w-fit">
                  {(["ai", "manual"] as const).map((mode) => (
                    <button key={mode} onClick={() => setDialogueMode(mode)}
                      className={`rounded-md px-4 py-1.5 text-xs font-ahsing transition-colors ${
                        dialogueMode === mode ? "bg-white shadow text-foreground" : "text-gray-500 hover:text-foreground"
                      }`}
                    >
                      {mode === "ai" ? "AI Generate" : "Write Manually"}
                    </button>
                  ))}
                </div>

                {dialogueMode === "ai" ? (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Personality</label>
                      <textarea
                        value={personality}
                        onChange={(e) => setPersonality(e.target.value)}
                        placeholder="Grumpy old merchant who secretly has a heart of gold..."
                        rows={3}
                        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                      />
                    </div>
                    <button
                      onClick={handleGenerateDialogue}
                      disabled={isGeneratingDialogue || !personality.trim()}
                      className="rounded-lg bg-accent px-4 py-2 text-xs font-ahsing text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {isGeneratingDialogue ? "Generating..." : "Generate Dialogue with AI"}
                    </button>
                    {dialogue.length > 0 && (
                      <ul className="space-y-1.5">
                        {dialogue.map((line, i) => (
                          <li key={i} className="text-sm text-gray-700 bg-gray-50 rounded-lg border border-gray-200 px-3 py-2">
                            {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ) : (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Dialogue Lines (one per line)</label>
                    <textarea
                      value={manualDialogue}
                      onChange={(e) => setManualDialogue(e.target.value)}
                      placeholder={"Have you heard the news?\nThe mines have been quiet lately.\nWatch yourself out there."}
                      rows={6}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                    />
                  </div>
                )}
              </div>

              {/* Style picker */}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-3">Dialogue Style</label>
                <div className="grid grid-cols-3 gap-2">
                  {STYLE_OPTIONS.map((style) => (
                    <button key={style.id} onClick={() => setDialogueStyle(style.id)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border-2 p-2 transition-all ${
                        dialogueStyle === style.id ? "border-accent shadow-sm" : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <DialogueStylePreview styleId={style.id} />
                      <span className="text-[9px] font-ahsing text-gray-600 text-center leading-tight">{style.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Live preview */}
            <div className="mt-6">
              <label className="block text-xs font-medium text-gray-500 mb-2">Preview</label>
              <DialogueLivePreview styleId={dialogueStyle} text={previewLine} npcName={npcName || "NPC"} />
            </div>

            <button onClick={handleSave} disabled={saveStatus === "saving"}
              className="mt-6 rounded-lg bg-green-600 px-8 py-2.5 text-sm font-ahsing text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              {saveStatus === "saving" ? "Saving..." : saveStatus === "saved" ? "Saved!" : "Save NPC to Library"}
            </button>
          </div>
        </div>
      )}

      {/* ── NPC Library ───────────────────────────────────────────────────── */}
      <div className="max-w-4xl mx-auto w-full px-8 py-8">
        <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-gray-400">
          NPC Library ({savedNPCs.length})
        </h2>
        {savedNPCs.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-12">No NPCs saved yet. Generate one above!</p>
        ) : (
          <div className="grid grid-cols-4 gap-4 sm:grid-cols-5 lg:grid-cols-6">
            {savedNPCs.map((npc) => (
              <NPCCard key={npc.id} npc={npc} onDelete={() => handleDelete(npc.id)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
