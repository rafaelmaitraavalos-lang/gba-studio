"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { getFirebaseAuth, getFirebaseDb } from "@/lib/firebase";
import {
  getDocs,
  query,
  orderBy,
  deleteDoc,
  doc,
  collection,
} from "firebase/firestore";

type Project = {
  id: string;
  name: string;
  createdAt: Date;
};

export default function Home() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    const db = getFirebaseDb();
    const q = query(
      collection(db, "users", user.uid, "projects"),
      orderBy("createdAt", "desc")
    );
    getDocs(q)
      .then((snapshot) => {
        const results: Project[] = snapshot.docs.map((d) => {
          const data = d.data();
          return {
            id: d.id,
            name: data.name ?? "Untitled",
            createdAt: data.createdAt?.toDate?.() ?? new Date(),
          };
        });
        setProjects(results);
      })
      .catch((err) => {
        console.error("Failed to load projects:", err);
      })
      .finally(() => {
        setLoadingProjects(false);
      });
  }, [user]);

  const handleDelete = async (id: string) => {
    if (!user) return;
    const db = getFirebaseDb();
    await deleteDoc(doc(db, "users", user.uid, "projects", id));
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setDeletingId(null);
  };

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

      <main className="flex flex-1 flex-col items-center px-4 py-10">
        {loadingProjects ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-gray-500">Loading projects...</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center">
            <h1 className="text-2xl font-bold">Your Projects</h1>
            <p className="mt-3 text-gray-500">
              No projects yet. Click New Game to start!
            </p>
            <Link
              href="/new-project"
              className="mt-8 rounded-lg bg-accent px-8 py-3 text-lg font-semibold text-white transition-colors hover:bg-blue-700"
            >
              New Game
            </Link>
          </div>
        ) : (
          <div className="w-full max-w-[900px]">
            <div className="mb-6 flex items-center justify-between">
              <h1 className="text-2xl font-bold">Your Projects</h1>
              <Link
                href="/new-project"
                className="rounded-lg bg-accent px-5 py-2 font-semibold text-white transition-colors hover:bg-blue-700"
              >
                + New Game
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="rounded-xl border-2 border-gray-200 bg-white p-5 transition-all hover:border-accent hover:shadow-lg hover:shadow-blue-100"
                >
                  {deletingId === project.id ? (
                    <div className="flex flex-col items-center gap-3 py-4">
                      <p className="font-semibold text-foreground">
                        Delete this project?
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setDeletingId(null)}
                          className="rounded-lg border border-gray-300 px-4 py-1.5 text-sm text-gray-600 transition-colors hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={() => handleDelete(project.id)}
                          className="rounded-lg bg-red-500 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-red-600"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <h2 className="text-lg font-semibold text-foreground">
                        {project.name}
                      </h2>
                      <p className="mt-1 text-sm text-gray-500">
                        {project.createdAt.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}
                      </p>
                      <div className="mt-4 flex items-center gap-2">
                        <Link
                          href="/project-hub"
                          className="rounded-lg bg-accent/10 px-3 py-1 text-sm text-accent transition-colors hover:bg-accent/20"
                        >
                          Rooms
                        </Link>
                        <Link
                          href="/project-hub/characters"
                          className="rounded-lg bg-accent/10 px-3 py-1 text-sm text-accent transition-colors hover:bg-accent/20"
                        >
                          Characters
                        </Link>
                        <button
                          onClick={() => setDeletingId(project.id)}
                          className="ml-auto text-gray-400 transition-colors hover:text-red-500"
                          aria-label="Delete project"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            fill="none"
                            viewBox="0 0 24 24"
                            strokeWidth={1.5}
                            stroke="currentColor"
                            className="h-5 w-5"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                            />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
