"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { doc, getDoc } from "firebase/firestore";
import { getFirebaseDb } from "./firebase";
import { useAuth } from "./auth-context";

interface ProjectContextValue {
  projectId: string;
  projectName: string;
  loading: boolean;
}

const ProjectContext = createContext<ProjectContextValue>({
  projectId: "",
  projectName: "",
  loading: true,
});

export function ProjectProvider({
  projectId,
  children,
}: {
  projectId: string;
  children: ReactNode;
}) {
  const { user } = useAuth();
  const [projectName, setProjectName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !projectId) return;
    const db = getFirebaseDb();
    getDoc(doc(db, "users", user.uid, "projects", projectId))
      .then((snap) => {
        if (snap.exists()) {
          setProjectName(snap.data().name ?? "Untitled");
        }
      })
      .finally(() => setLoading(false));
  }, [user, projectId]);

  return (
    <ProjectContext value={{ projectId, projectName, loading }}>
      {children}
    </ProjectContext>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
