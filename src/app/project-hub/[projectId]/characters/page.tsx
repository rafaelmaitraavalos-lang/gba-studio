"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc,
  updateDoc, serverTimestamp,
} from "firebase/firestore";
import ProjectHubNav from "@/components/project-hub/ProjectHubNav";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RotationUrls {
  south: string;
  west:  string;
  east:  string;
  north: string;
}

interface SavedChar {
  id: string;
  name: string;
  description: string;
  pixellabCharacterId?: string;
  rotationUrls?: RotationUrls;  // base64 data URIs for 4 directions
  spritesheetUrl?: string;      // walk cycle spritesheet
  animationStatus?: "animating"; // set when animate job fired but timed out / failed
  // Legacy support
  layers?: { spritesheet: string }[];
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

// ─── Character thumbnail ──────────────────────────────────────────────────────

/** Shows south idle image (V2) or first frame of spritesheet (legacy). */
function CharThumb({ char, size = 80 }: { char: SavedChar; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // V2: show south rotation image directly
  if (char.rotationUrls?.south) {
    const src = char.rotationUrls.south.startsWith("data:")
      ? char.rotationUrls.south
      : `data:image/png;base64,${char.rotationUrls.south}`;
    return (
      <img
        src={src}
        alt={char.name}
        style={{ width: size, height: size, imageRendering: "pixelated", display: "block" }}
        className="rounded"
      />
    );
  }

  // Legacy: extract first frame from spritesheet via canvas
  const spritesheetUrl = char.spritesheetUrl ?? char.layers?.[0]?.spritesheet;
  useEffect(() => {
    if (!spritesheetUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
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
    img.src = spritesheetUrl;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spritesheetUrl, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: "pixelated", display: "block" }}
      className="rounded"
    />
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CharactersPage() {
  const { user, loading } = useAuth();
  const { projectId } = useProject();
  const router = useRouter();

  // ── Saved characters ──────────────────────────────────────────────────────
  const [savedChars, setSavedChars]         = useState<SavedChar[]>([]);
  const [animatingId, setAnimatingId]       = useState<string | null>(null);  // card-level spinner
  const [animateError, setAnimateError]     = useState<string | null>(null);

  // ── Generate new character form ───────────────────────────────────────────
  const [description, setDescription]       = useState("");
  const [charName, setCharName]             = useState("New Character");
  const [isGenerating, setIsGenerating]     = useState(false);
  const [genError, setGenError]             = useState<string | null>(null);
  const [genResult, setGenResult]           = useState<{ character_id: string } & RotationUrls | null>(null);
  const [isSaving, setIsSaving]             = useState(false);

  const [elapsed, setElapsed]               = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Load saved characters
  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDocs(collection(db, "users", user.uid, "projects", projectId, "characters")).then((snap) => {
      const chars: SavedChar[] = snap.docs.map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          id:                    d.id,
          name:                  (data.name        as string | undefined) ?? "Character",
          description:           (data.description as string | undefined) ?? (data.prompt as string | undefined) ?? "",
          pixellabCharacterId:   (data.pixellabCharacterId as string | undefined),
          rotationUrls:          (data.rotationUrls as RotationUrls | undefined),
          spritesheetUrl:        (data.spritesheetUrl as string | undefined),
          animationStatus:       (data.animationStatus as "animating" | undefined),
          layers:                (data.layers as { spritesheet: string }[] | undefined),
        };
      });
      setSavedChars(chars);
    });
  }, [user, projectId]);

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

  // ── Generate character ──────────────────────────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!description.trim() || isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    setGenResult(null);
    startTimer();
    try {
      const res = await fetch("/api/create-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: description.trim() }),
      });
      const data = await res.json() as {
        character_id?: string; south?: string; west?: string; east?: string; north?: string; error?: string;
      };
      if (!res.ok || !data.character_id || !data.south) {
        setGenError(data.error ?? "Generation failed");
        return;
      }
      setGenResult({
        character_id: data.character_id,
        south: data.south,
        west:  data.west!,
        east:  data.east!,
        north: data.north!,
      });
    } catch {
      setGenError("Failed to generate character");
    } finally {
      stopTimer();
      setIsGenerating(false);
    }
  }, [description, isGenerating]);

  // ── Save generated character ────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!user || !genResult || isSaving) return;
    setIsSaving(true);
    try {
      const db = getFirebaseDb();
      const docRef = await addDoc(
        collection(db, "users", user.uid, "projects", projectId, "characters"),
        {
          name:                 charName.trim() || "Character",
          description:          description.trim(),
          pixellabCharacterId:  genResult.character_id,
          rotationUrls: {
            south: genResult.south,
            west:  genResult.west,
            east:  genResult.east,
            north: genResult.north,
          },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
      );
      const newChar: SavedChar = {
        id:                   docRef.id,
        name:                 charName.trim() || "Character",
        description:          description.trim(),
        pixellabCharacterId:  genResult.character_id,
        rotationUrls: {
          south: genResult.south,
          west:  genResult.west,
          east:  genResult.east,
          north: genResult.north,
        },
      };
      setSavedChars((prev) => [newChar, ...prev]);
      // Reset form
      setGenResult(null);
      setDescription("");
      setCharName("New Character");
    } catch (err) {
      console.error("Save failed:", err);
      setGenError("Failed to save character");
    } finally {
      setIsSaving(false);
    }
  }, [user, projectId, genResult, charName, description, isSaving]);

  // ── Animate walk cycle for a saved character ────────────────────────────────
  const handleAnimate = useCallback(async (char: SavedChar) => {
    if (!char.pixellabCharacterId || animatingId) return;
    setAnimatingId(char.id);
    setAnimateError(null);
    try {
      const res = await fetch("/api/animate-character", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character_id: char.pixellabCharacterId }),
      });
      const data = await res.json() as { spritesheetUrl?: string; error?: string };
      if (!res.ok || !data.spritesheetUrl) {
        // Job may still be running on PixelLab's side — mark as "animating"
        // so the user can check status later
        const db = getFirebaseDb();
        await updateDoc(
          doc(db, "users", user!.uid, "projects", projectId, "characters", char.id),
          { animationStatus: "animating", updatedAt: serverTimestamp() },
        );
        setSavedChars((prev) =>
          prev.map((c) => c.id === char.id ? { ...c, animationStatus: "animating" } : c),
        );
        setAnimateError(
          (data.error ?? "Animation timed out") +
          " — the job may still be running. Use \"Check Status\" to retrieve it.",
        );
        return;
      }
      // Success: save spritesheet and clear animation status
      const db = getFirebaseDb();
      await updateDoc(
        doc(db, "users", user!.uid, "projects", projectId, "characters", char.id),
        { spritesheetUrl: data.spritesheetUrl, animationStatus: null, updatedAt: serverTimestamp() },
      );
      setSavedChars((prev) =>
        prev.map((c) =>
          c.id === char.id ? { ...c, spritesheetUrl: data.spritesheetUrl, animationStatus: undefined } : c,
        ),
      );
    } catch (err) {
      // Network / server error — mark animating so user can check later
      const db = getFirebaseDb();
      await updateDoc(
        doc(db, "users", user!.uid, "projects", projectId, "characters", char.id),
        { animationStatus: "animating", updatedAt: serverTimestamp() },
      ).catch(() => {});
      setSavedChars((prev) =>
        prev.map((c) => c.id === char.id ? { ...c, animationStatus: "animating" } : c),
      );
      setAnimateError(
        (err as Error).message +
        " — use \"Check Status\" to retrieve the result if the job completed.",
      );
    } finally {
      setAnimatingId(null);
    }
  }, [animatingId, user, projectId]);

  // ── Check if PixelLab animation finished (for "animating" characters) ────────
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const handleCheckStatus = useCallback(async (char: SavedChar) => {
    if (!char.pixellabCharacterId || checkingId) return;
    setCheckingId(char.id);
    setAnimateError(null);
    try {
      const res = await fetch(
        `/api/check-character-animation?character_id=${encodeURIComponent(char.pixellabCharacterId)}`,
      );
      const data = await res.json() as { complete?: boolean; spritesheetUrl?: string; error?: string };
      if (!res.ok) {
        setAnimateError(data.error ?? "Check failed");
        return;
      }
      if (data.complete && data.spritesheetUrl) {
        const db = getFirebaseDb();
        await updateDoc(
          doc(db, "users", user!.uid, "projects", projectId, "characters", char.id),
          { spritesheetUrl: data.spritesheetUrl, animationStatus: null, updatedAt: serverTimestamp() },
        );
        setSavedChars((prev) =>
          prev.map((c) =>
            c.id === char.id
              ? { ...c, spritesheetUrl: data.spritesheetUrl, animationStatus: undefined }
              : c,
          ),
        );
      } else {
        setAnimateError("Animation not ready yet — try again in a moment.");
      }
    } catch (err) {
      setAnimateError((err as Error).message);
    } finally {
      setCheckingId(null);
    }
  }, [checkingId, user, projectId]);

  // ── Delete character ──────────────────────────────────────────────────────
  const handleDelete = useCallback(async (charId: string) => {
    if (!user || !window.confirm("Delete this character?")) return;
    try {
      const db = getFirebaseDb();
      await deleteDoc(doc(db, "users", user.uid, "projects", projectId, "characters", charId));
      setSavedChars((prev) => prev.filter((c) => c.id !== charId));
    } catch (err) {
      console.error("Delete failed:", err);
    }
  }, [user, projectId]);

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
        <div className="mx-auto w-full max-w-3xl px-6 pt-8 pb-16">

          {/* ── Generate new character ── */}
          <SectionLabel>Generate New Character</SectionLabel>
          <div className="mb-10 mx-auto w-full max-w-[520px] rounded-2xl border border-gray-200 bg-white p-8 shadow-sm flex flex-col gap-5">

            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                Description
              </label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. knight with blue armor and red cape"
                disabled={isGenerating}
                className="resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400 disabled:opacity-50"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={isGenerating || !description.trim()}
              className="rounded-xl bg-purple-600 py-3 text-sm font-medium text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
            >
              {isGenerating
                ? `Generating… ${fmtTime(elapsed)}`
                : "Generate Character"}
            </button>

            {isGenerating && (
              <div className="flex flex-col items-center gap-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-purple-200 border-t-purple-600" />
                <p className="text-center text-xs text-gray-500">
                  Creating 4-direction character with PixelLab…
                </p>
              </div>
            )}

            {genError && (
              <p className="text-center text-sm text-red-500">{genError}</p>
            )}

            {/* Direction previews + save form */}
            {genResult && !isGenerating && (
              <div className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-gray-50 p-4">
                <p className="text-center text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Preview — 4 Directions
                </p>
                <div className="flex justify-center gap-4">
                  {(["south", "west", "east", "north"] as const).map((dir) => (
                    <div key={dir} className="flex flex-col items-center gap-1">
                      <img
                        src={genResult[dir]}
                        alt={dir}
                        style={{ width: 64, height: 64, imageRendering: "pixelated" }}
                        className="rounded-md border border-gray-200"
                      />
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">{dir}</span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
                    Character Name
                  </label>
                  <input
                    type="text"
                    value={charName}
                    maxLength={30}
                    onChange={(e) => setCharName(e.target.value)}
                    className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-purple-400"
                  />
                </div>

                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="rounded-xl bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60 transition-colors"
                >
                  {isSaving ? "Saving…" : "Save Character"}
                </button>
              </div>
            )}
          </div>

          {/* ── Saved characters grid ── */}
          {savedChars.length > 0 && (
            <>
              <SectionLabel>Your Characters ({savedChars.length})</SectionLabel>
              {animateError && (
                <p className="mb-4 text-center text-sm text-red-500">{animateError}</p>
              )}
              <div className="flex flex-wrap justify-center gap-4">
                {savedChars.map((char) => (
                  <div
                    key={char.id}
                    className="relative flex flex-col items-center rounded-2xl border-2 border-gray-200 bg-white p-4 shadow-sm w-[140px]"
                  >
                    {/* Delete button */}
                    <button
                      onClick={() => handleDelete(char.id)}
                      className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-[10px] text-red-500 hover:bg-red-200"
                      title="Delete"
                    >
                      &times;
                    </button>

                    <CharThumb char={char} size={80} />
                    <p className="mt-2 w-full truncate text-center text-[11px] font-ahsing text-gray-700">
                      {char.name}
                    </p>

                    {/* Animate walk / Check status — only for V2 characters without a spritesheet yet */}
                    {char.pixellabCharacterId && !char.spritesheetUrl && (
                      char.animationStatus === "animating" ? (
                        <button
                          onClick={() => handleCheckStatus(char)}
                          disabled={!!checkingId}
                          className="mt-2 w-full rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-500 hover:text-white disabled:opacity-50 transition-colors"
                        >
                          {checkingId === char.id ? (
                            <span className="flex items-center justify-center gap-1">
                              <span className="h-3 w-3 animate-spin rounded-full border border-amber-400 border-t-transparent" />
                              Checking…
                            </span>
                          ) : "Check Status"}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleAnimate(char)}
                          disabled={!!animatingId}
                          className="mt-2 w-full rounded-lg bg-indigo-100 px-2 py-1 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-600 hover:text-white disabled:opacity-50 transition-colors"
                        >
                          {animatingId === char.id ? (
                            <span className="flex items-center justify-center gap-1">
                              <span className="h-3 w-3 animate-spin rounded-full border border-indigo-400 border-t-transparent" />
                              Animating…
                            </span>
                          ) : "Animate Walk"}
                        </button>
                      )
                    )}

                    {char.spritesheetUrl && (
                      <span className="mt-2 rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-semibold text-green-600">
                        Walk ready
                      </span>
                    )}

                    <Link
                      href={`/project-hub/${projectId}/equip?characterId=${char.id}`}
                      className="mt-2 w-full rounded-lg bg-purple-100 px-2 py-1 text-center text-[10px] font-semibold text-purple-700 hover:bg-purple-600 hover:text-white transition-colors"
                    >
                      Equip →
                    </Link>
                  </div>
                ))}
              </div>
            </>
          )}

        </div>
      </div>
    </div>
  );
}
