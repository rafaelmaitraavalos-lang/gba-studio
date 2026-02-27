"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { collection, getDocs } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";
import { getFirebaseDb } from "@/lib/firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RoomPreview  { id: string; name: string; imageBase64: string }
interface CharPreview  { id: string; name: string; layers: { spritesheet: string; zIndex: number }[] }
interface SpritePreview { id: string; name: string; spritesheet: string }
interface ThumbPreview  { id: string; name: string; imageBase64: string }

// ─── Cycling image preview (rooms / objects / accessories) ───────────────────

function CyclingImages({ items }: { items: { imageBase64: string }[] }) {
  const [idx, setIdx] = useState(0);
  const [fade, setFade] = useState(true);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setIdx((i) => (i + 1) % items.length);
        setFade(true);
      }, 300);
    }, 2000);
    return () => clearInterval(t);
  }, [items.length]);
  if (!items.length) return <DefaultPreview />;
  return (
    <img
      src={items[idx]?.imageBase64}
      alt=""
      className="h-full w-full object-cover"
      style={{
        imageRendering: "pixelated",
        opacity: fade ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    />
  );
}

// ─── Spritesheet walk animation (mobs / NPCs) ────────────────────────────────

// Spritesheet layout: 4 cols = frames 0-3, 4 rows = up/right/down/left
const DIR_ROW = [0, 1, 2, 3]; // cycle through all 4 directions

function SpriteWalkCanvas({ items }: { items: SpritePreview[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !items.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    let itemIdx = 0;
    let frame   = 0;
    let dirIdx  = 0;
    let lastFrameTs  = 0;
    let lastItemTs   = 0;

    const images: HTMLImageElement[] = items.map((it) => {
      const img = new Image();
      img.src = it.spritesheet;
      return img;
    });

    function draw(ts: number) {
      if (!ctx || !canvas) return;
      if (ts - lastFrameTs >= 150) {
        frame = (frame + 1) % 4;
        lastFrameTs = ts;
      }
      // Cycle direction every 600ms
      if (ts - lastItemTs >= 2400) {
        itemIdx = (itemIdx + 1) % images.length;
        dirIdx  = 0;
        lastItemTs = ts;
      } else if (ts - lastItemTs >= 1800) {
        dirIdx = 3;
      } else if (ts - lastItemTs >= 1200) {
        dirIdx = 2;
      } else if (ts - lastItemTs >= 600) {
        dirIdx = 1;
      }

      const img = images[itemIdx];
      if (!img.complete || img.naturalWidth === 0) { rafRef.current = requestAnimationFrame(draw); return; }

      const fw = img.naturalWidth  / 4;
      const fh = img.naturalHeight / 4;
      const row = DIR_ROW[dirIdx];

      const drawSize = Math.round(canvas.width * 0.65);
      const ox = Math.round((canvas.width  - drawSize) / 2);
      const oy = Math.round((canvas.height - drawSize) / 2);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, frame * fw, row * fh, fw, fh, ox, oy, drawSize, drawSize);

      // Name label
      if (items[itemIdx]?.name) {
        ctx.font = "10px 'Ahsing', sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, canvas.height - 16, canvas.width, 16);
        ctx.fillStyle = "#fff";
        ctx.fillText(items[itemIdx].name, canvas.width / 2, canvas.height - 4);
      }

      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [items]);

  if (!items.length) return <DefaultPreview />;
  return <canvas ref={canvasRef} width={128} height={128} className="h-full" style={{ imageRendering: "pixelated", WebkitImageRendering: "crisp-edges" } as React.CSSProperties} />;
}

// ─── Layered character walk animation ────────────────────────────────────────

function CharWalkCanvas({ items }: { items: CharPreview[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !items.length) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    // Pre-load all layer images for all characters
    type LayerImg = { img: HTMLImageElement; zIndex: number };
    const charLayers: LayerImg[][] = items.map((ch) =>
      [...ch.layers]
        .sort((a, b) => a.zIndex - b.zIndex)
        .map((l) => { const img = new Image(); img.src = l.spritesheet; return { img, zIndex: l.zIndex }; })
    );

    let itemIdx   = 0;
    let frame     = 0;
    let dirIdx    = 0;
    let lastFrameTs = 0;
    let lastItemTs  = 0;

    function draw(ts: number) {
      if (!ctx || !canvas) return;
      if (ts - lastFrameTs >= 150) {
        frame = (frame + 1) % 4;
        lastFrameTs = ts;
      }
      if (ts - lastItemTs >= 2400) {
        itemIdx = (itemIdx + 1) % items.length;
        dirIdx  = 0;
        lastItemTs = ts;
      } else if (ts - lastItemTs >= 1800) {
        dirIdx = 3;
      } else if (ts - lastItemTs >= 1200) {
        dirIdx = 2;
      } else if (ts - lastItemTs >= 600) {
        dirIdx = 1;
      }

      const layers = charLayers[itemIdx] ?? [];
      const row = DIR_ROW[dirIdx];

      const drawSize = Math.round(canvas.width * 0.65);
      const ox = Math.round((canvas.width  - drawSize) / 2);
      const oy = Math.round((canvas.height - drawSize) / 2);

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.imageSmoothingEnabled = false;
      for (const { img } of layers) {
        if (!img.complete || img.naturalWidth === 0) continue;
        const fw = img.naturalWidth  / 4;
        const fh = img.naturalHeight / 4;
        ctx.drawImage(img, frame * fw, row * fh, fw, fh, ox, oy, drawSize, drawSize);
      }

      // Name label
      const name = items[itemIdx]?.name;
      if (name) {
        ctx.font = "10px 'Ahsing', sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(0, canvas.height - 16, canvas.width, 16);
        ctx.fillStyle = "#fff";
        ctx.fillText(name, canvas.width / 2, canvas.height - 4);
      }

      rafRef.current = requestAnimationFrame(draw);
    }
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [items]);

  if (!items.length) return <DefaultPreview />;
  return <canvas ref={canvasRef} width={128} height={128} className="h-full" style={{ imageRendering: "pixelated", WebkitImageRendering: "crisp-edges" } as React.CSSProperties} />;
}

// ─── Fallback placeholder ─────────────────────────────────────────────────────

function DefaultPreview() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <span className="text-3xl opacity-20">+</span>
    </div>
  );
}

// ─── Card wrapper ─────────────────────────────────────────────────────────────

function HubCard({
  href, label, description, preview,
}: {
  href: string;
  label: string;
  description: string;
  preview: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-xl border-2 border-gray-200 bg-white overflow-hidden transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
    >
      <div className="h-32 w-full bg-gray-100 overflow-hidden flex items-center justify-center">
        {preview}
      </div>
      <div className="p-4">
        <span className="block text-lg font-ahsing text-foreground">{label}</span>
        <span className="mt-0.5 block text-sm text-gray-500">{description}</span>
      </div>
    </Link>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HubMenu() {
  const { user, loading } = useAuth();
  const { projectId, projectName, loading: projectLoading } = useProject();
  const router = useRouter();

  const [rooms,       setRooms]       = useState<RoomPreview[]>([]);
  const [characters,  setCharacters]  = useState<CharPreview[]>([]);
  const [objects,     setObjects]     = useState<ThumbPreview[]>([]);
  const [mobs,        setMobs]        = useState<SpritePreview[]>([]);
  const [npcs,        setNpcs]        = useState<SpritePreview[]>([]);
  const [equippedChars, setEquippedChars] = useState<SpritePreview[]>([]);
  const [items,         setItems]         = useState<ThumbPreview[]>([]);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    const base = `users/${user.uid}/projects/${projectId}`;

    getDocs(collection(db, base, "rooms")).then((snap) =>
      setRooms(snap.docs.map((d) => ({ id: d.id, name: d.data().name ?? "Room", imageBase64: d.data().imageBase64 ?? "" })).filter((r) => r.imageBase64))
    );

    getDocs(collection(db, base, "characters")).then((snap) =>
      setCharacters(snap.docs.map((d) => ({
        id: d.id,
        name: d.data().name ?? "Character",
        layers: (d.data().layers as { spritesheet: string; zIndex: number }[] | undefined) ?? [],
      })).filter((c) => c.layers.length > 0))
    );

    getDocs(collection(db, base, "objects")).then((snap) =>
      setObjects(snap.docs.map((d) => ({ id: d.id, name: d.data().name ?? "Object", imageBase64: d.data().imageBase64 ?? "" })).filter((o) => o.imageBase64))
    );

    getDocs(collection(db, base, "mobs")).then((snap) =>
      setMobs(snap.docs.map((d) => ({ id: d.id, name: d.data().name ?? "Mob", spritesheet: d.data().spritesheet ?? "" })).filter((m) => m.spritesheet))
    );

    getDocs(collection(db, base, "npcs")).then((snap) =>
      setNpcs(snap.docs.map((d) => ({ id: d.id, name: d.data().name ?? "NPC", spritesheet: d.data().spritesheet ?? "" })).filter((n) => n.spritesheet))
    );

    getDocs(collection(db, base, "equipped")).then((snap) =>
      setEquippedChars(snap.docs.map((d) => ({ id: d.id, name: d.data().name ?? "Equipped", spritesheet: d.data().spritesheet ?? "" })).filter((e) => e.spritesheet))
    );

    getDocs(collection(db, base, "items")).then((snap) =>
      setItems(snap.docs.map((d) => ({ id: d.id, name: d.data().name ?? "Item", imageBase64: d.data().imageBase64 ?? "" })).filter((a) => a.imageBase64))
    );
  }, [user, projectId]);

  if (loading || projectLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center px-4 py-10">
      <img src="/logo.png" alt="GBA Studio" style={{ height: "100px" }} />
      <p className="mt-3 text-2xl text-foreground font-ahsing">{projectName}</p>

      <div className="mt-8 grid w-full max-w-[720px] grid-cols-3 gap-5">
        <HubCard
          href={`/project-hub/${projectId}/rooms`}
          label="Build Room"
          description="Design your world tile by tile"
          preview={<CyclingImages items={rooms} />}
        />
        <HubCard
          href={`/project-hub/${projectId}/characters`}
          label="Build Character"
          description="Draw your hero pixel by pixel"
          preview={<CharWalkCanvas items={characters} />}
        />
        <HubCard
          href={`/project-hub/${projectId}/equip`}
          label="Equip"
          description="Dress your characters with items"
          preview={<SpriteWalkCanvas items={equippedChars} />}
        />
        <HubCard
          href={`/project-hub/${projectId}/objects`}
          label="Objects"
          description="Generate chests, altars & props"
          preview={<CyclingImages items={objects} />}
        />
        <HubCard
          href={`/project-hub/${projectId}/mobs`}
          label="Mobs"
          description="Generate enemies & creatures"
          preview={<SpriteWalkCanvas items={mobs} />}
        />
        <HubCard
          href={`/project-hub/${projectId}/npcs`}
          label="NPCs"
          description="Create villagers & dialogue"
          preview={<SpriteWalkCanvas items={npcs} />}
        />
        <HubCard
          href={`/project-hub/${projectId}/items`}
          label="Items"
          description="Generate weapons, armor & accessories"
          preview={<CyclingImages items={items} />}
        />
      </div>

      {/* Builder Mode — full-width prominent button */}
      <div className="mt-5 w-full max-w-[720px]">
        <Link
          href={`/project-hub/${projectId}/builder-mode`}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-accent px-8 py-5 text-white transition-all hover:bg-blue-700 hover:shadow-lg hover:shadow-blue-300"
        >
          <svg width="28" height="28" viewBox="0 0 48 48" fill="none">
            <polygon points="10,8 42,24 10,40" fill="currentColor" />
          </svg>
          <div className="text-left">
            <span className="block text-xl font-ahsing">Builder Mode</span>
            <span className="block text-sm opacity-70">Place rooms, objects, NPCs and playtest your world</span>
          </div>
        </Link>
      </div>

      <Link href="/" className="mt-8 text-sm text-gray-500 hover:text-foreground">
        &larr; Back to Projects
      </Link>
    </div>
  );
}
