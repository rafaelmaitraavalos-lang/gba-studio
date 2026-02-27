"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface ProjectHubNavProps {
  projectId: string;
  onSave: () => void;
  saveStatus: "idle" | "saving" | "saved";
  saveDisabled?: boolean;
}

export default function ProjectHubNav({ projectId, onSave, saveStatus, saveDisabled }: ProjectHubNavProps) {
  const pathname = usePathname();
  const base = `/project-hub/${projectId}`;

  const TABS = [
    { label: "Hub", href: base },
    { label: "Rooms", href: `${base}/rooms` },
    { label: "Objects", href: `${base}/objects` },
    { label: "Mobs", href: `${base}/mobs` },
    { label: "NPCs", href: `${base}/npcs` },
    { label: "Characters", href: `${base}/characters` },
    { label: "Equip", href: `${base}/equip` },
    { label: "Items", href: `${base}/items` },
  ];

  return (
    <nav className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
      <div className="flex items-center gap-6">
        <img src='/logo.png' alt='GBA Studio' style={{ height: '48px' }} />
        <Link href="/" className="text-sm text-gray-500 hover:text-foreground">
          &larr; Back
        </Link>
        <div className="flex gap-1">
          {TABS.map((tab) => {
            const isActive = pathname === tab.href;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-ahsing transition-colors ${
                  isActive
                    ? "bg-accent text-white"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </div>
      </div>
      <button
        onClick={onSave}
        disabled={saveDisabled || saveStatus === "saving"}
        className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
      >
        {saveStatus === "saving"
          ? "Saving..."
          : saveStatus === "saved"
            ? "Saved!"
            : "Save"}
      </button>
    </nav>
  );
}
