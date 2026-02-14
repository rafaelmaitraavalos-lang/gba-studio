"use client";

import { use, type ReactNode } from "react";
import { ProjectProvider } from "@/lib/project-context";

export default function ProjectLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);

  return <ProjectProvider projectId={projectId}>{children}</ProjectProvider>;
}
