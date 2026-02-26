"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getFirebaseDb } from "@/lib/firebase";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";

export default function NewProject() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [gameName, setGameName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  async function handleCreate() {
    if (!gameName.trim()) {
      inputRef.current?.focus();
      return;
    }
    if (saving || !user) return;

    setSaving(true);
    try {
      const db = getFirebaseDb();
      const docRef = await addDoc(collection(db, "users", user.uid, "projects"), {
        name: gameName.trim(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      router.push(`/project-hub/${docRef.id}`);
    } catch (err) {
      console.error("Failed to create project:", err);
      setSaving(false);
    }
  }

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <img src='/logo.png' alt='GBA Studio' style={{ height: '120px' }} />

      <input
        ref={inputRef}
        type="text"
        placeholder="Enter your game name..."
        maxLength={30}
        value={gameName}
        onChange={(e) => setGameName(e.target.value)}
        className="mt-8 w-full max-w-[400px] rounded-lg border border-gray-300 px-4 py-3 text-center text-lg focus:outline-none focus:ring-2 focus:ring-accent"
      />

      <button
        onClick={handleCreate}
        disabled={saving}
        className="mt-8 rounded-lg bg-accent px-8 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Creating..." : "Create Game"}
      </button>
    </div>
  );
}
