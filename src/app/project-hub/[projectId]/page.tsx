"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { useProject } from "@/lib/project-context";

export default function HubMenu() {
  const { user, loading } = useAuth();
  const { projectId, projectName, loading: projectLoading } = useProject();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  if (loading || projectLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <img src='/logo.png' alt='GBA Studio' style={{ height: '120px' }} />
      <p className="mt-4 text-2xl text-foreground font-ahsing">{projectName}</p>

      <div className="mt-10 grid w-full max-w-[700px] grid-cols-3 gap-6">
        {/* Build Room */}
        <Link
          href={`/project-hub/${projectId}/rooms`}
          className="flex flex-col items-center rounded-xl border-2 border-gray-200 bg-white p-6 transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            className="mb-4 text-accent"
          >
            <rect x="4" y="4" width="9" height="9" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="15" y="4" width="9" height="9" rx="1" fill="currentColor" opacity="0.8" />
            <rect x="26" y="4" width="9" height="9" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="37" y="4" width="7" height="9" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="4" y="15" width="9" height="9" rx="1" fill="currentColor" opacity="0.8" />
            <rect x="15" y="15" width="9" height="9" rx="1" fill="currentColor" />
            <rect x="26" y="15" width="9" height="9" rx="1" fill="currentColor" opacity="0.8" />
            <rect x="37" y="15" width="7" height="9" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="4" y="26" width="9" height="9" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="15" y="26" width="9" height="9" rx="1" fill="currentColor" opacity="0.8" />
            <rect x="26" y="26" width="9" height="9" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="37" y="26" width="7" height="9" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="4" y="37" width="9" height="7" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="15" y="37" width="9" height="7" rx="1" fill="currentColor" opacity="0.6" />
            <rect x="26" y="37" width="9" height="7" rx="1" fill="currentColor" opacity="0.4" />
            <rect x="37" y="37" width="7" height="7" rx="1" fill="currentColor" opacity="0.3" />
          </svg>
          <span className="text-lg font-ahsing text-foreground">Build Room</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Design your world tile by tile
          </span>
        </Link>

        {/* Objects */}
        <Link
          href={`/project-hub/${projectId}/objects`}
          className="flex flex-col items-center rounded-xl border-2 border-gray-200 bg-white p-6 transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            className="mb-4 text-accent"
          >
            <rect x="10" y="28" width="28" height="14" rx="2" fill="currentColor" opacity="0.5" />
            <rect x="14" y="20" width="20" height="12" rx="2" fill="currentColor" opacity="0.75" />
            <rect x="18" y="10" width="12" height="12" rx="2" fill="currentColor" />
            <rect x="20" y="6" width="8" height="6" rx="1" fill="currentColor" opacity="0.6" />
          </svg>
          <span className="text-lg font-ahsing text-foreground">Objects</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Generate chests, altars & props
          </span>
        </Link>

        {/* Build Character */}
        <Link
          href={`/project-hub/${projectId}/characters`}
          className="flex flex-col items-center rounded-xl border-2 border-gray-200 bg-white p-6 transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            className="mb-4 text-accent"
          >
            <rect x="16" y="4" width="16" height="14" rx="3" fill="currentColor" />
            <rect x="14" y="20" width="20" height="14" rx="2" fill="currentColor" opacity="0.8" />
            <rect x="6" y="20" width="6" height="12" rx="2" fill="currentColor" opacity="0.6" />
            <rect x="36" y="20" width="6" height="12" rx="2" fill="currentColor" opacity="0.6" />
            <rect x="16" y="36" width="6" height="8" rx="2" fill="currentColor" opacity="0.7" />
            <rect x="26" y="36" width="6" height="8" rx="2" fill="currentColor" opacity="0.7" />
          </svg>
          <span className="text-lg font-ahsing text-foreground">Build Character</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Draw your hero pixel by pixel
          </span>
        </Link>

        {/* Accessories */}
        <Link
          href={`/project-hub/${projectId}/accessories`}
          className="flex flex-col items-center rounded-xl border-2 border-gray-200 bg-white p-6 transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            className="mb-4 text-accent"
          >
            <path d="M24 4L28 16H40L30 24L34 36L24 28L14 36L18 24L8 16H20L24 4Z" fill="currentColor" opacity="0.8" />
          </svg>
          <span className="text-lg font-ahsing text-foreground">Accessories</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Generate capes, hats & weapons
          </span>
        </Link>

        {/* Mobs */}
        <Link
          href={`/project-hub/${projectId}/mobs`}
          className="flex flex-col items-center rounded-xl border-2 border-gray-200 bg-white p-6 transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            className="mb-4 text-accent"
          >
            <ellipse cx="24" cy="28" rx="14" ry="10" fill="currentColor" opacity="0.5" />
            <ellipse cx="24" cy="22" rx="10" ry="10" fill="currentColor" opacity="0.8" />
            <rect x="18" y="14" width="4" height="6" rx="2" fill="currentColor" />
            <rect x="26" y="14" width="4" height="6" rx="2" fill="currentColor" />
            <circle cx="20" cy="21" r="2" fill="white" />
            <circle cx="28" cy="21" r="2" fill="white" />
          </svg>
          <span className="text-lg font-ahsing text-foreground">Mobs</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Generate enemies & creatures
          </span>
        </Link>

        {/* NPCs */}
        <Link
          href={`/project-hub/${projectId}/npcs`}
          className="flex flex-col items-center rounded-xl border-2 border-gray-200 bg-white p-6 transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            className="mb-4 text-accent"
          >
            <rect x="16" y="4" width="16" height="14" rx="3" fill="currentColor" />
            <rect x="14" y="20" width="20" height="14" rx="2" fill="currentColor" opacity="0.8" />
            <rect x="6" y="20" width="6" height="12" rx="2" fill="currentColor" opacity="0.6" />
            <rect x="36" y="20" width="6" height="12" rx="2" fill="currentColor" opacity="0.6" />
            <rect x="16" y="36" width="6" height="8" rx="2" fill="currentColor" opacity="0.7" />
            <rect x="26" y="36" width="6" height="8" rx="2" fill="currentColor" opacity="0.7" />
            <rect x="28" y="8" width="14" height="10" rx="2" fill="white" stroke="currentColor" strokeWidth="1.5" />
            <rect x="30" y="11" width="10" height="1.5" rx="0.75" fill="currentColor" opacity="0.6" />
            <rect x="30" y="14" width="7" height="1.5" rx="0.75" fill="currentColor" opacity="0.6" />
            <polygon points="30,18 34,21 34,18" fill="white" stroke="currentColor" strokeWidth="1" />
          </svg>
          <span className="text-lg font-ahsing text-foreground">NPCs</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Create villagers & dialogue
          </span>
        </Link>

        {/* Builder Mode */}
        <Link
          href={`/project-hub/${projectId}/builder-mode`}
          className="flex flex-col items-center rounded-xl border-2 border-gray-200 bg-white p-6 transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
        >
          <svg
            width="48"
            height="48"
            viewBox="0 0 48 48"
            fill="none"
            className="mb-4 text-accent"
          >
            <polygon points="16,8 40,24 16,40" fill="currentColor" />
          </svg>
          <span className="text-lg font-ahsing text-foreground">Builder Mode</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Playtest your game world
          </span>
        </Link>
      </div>

      <Link
        href="/"
        className="mt-10 text-sm text-gray-500 hover:text-foreground"
      >
        &larr; Back to Projects
      </Link>
    </div>
  );
}
