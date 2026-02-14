"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {/* Navbar */}
      <nav className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
        <span className="font-pixel text-sm text-accent">GBA Studio</span>
        <button
          onClick={() => signOut(getFirebaseAuth())}
          className="text-sm text-gray-500 hover:text-foreground"
        >
          Log Out
        </button>
      </nav>

      {/* Empty state */}
      <main className="flex flex-1 flex-col items-center justify-center px-4">
        <h1 className="text-2xl font-bold">Your Projects</h1>
        <p className="mt-3 text-gray-500">
          You haven&apos;t created any games yet.
        </p>
        <Link
          href="/project-hub"
          className="mt-8 rounded-lg bg-accent px-8 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-700"
        >
          New Game
        </Link>
      </main>
    </div>
  );
}
