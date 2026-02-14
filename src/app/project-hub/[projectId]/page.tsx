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
      <h1 className="font-pixel text-2xl text-accent">GBA Studio</h1>
      <p className="mt-4 text-lg font-semibold text-foreground">{projectName}</p>

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
          <span className="text-lg font-semibold text-foreground">Build Room</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Design your world tile by tile
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
          <span className="text-lg font-semibold text-foreground">Build Character</span>
          <span className="mt-1 text-center text-sm text-gray-500">
            Draw your hero pixel by pixel
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
          <span className="text-lg font-semibold text-foreground">Builder Mode</span>
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
