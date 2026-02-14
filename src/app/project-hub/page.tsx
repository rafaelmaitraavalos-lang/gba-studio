"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProjectHubRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <p className="text-gray-500">Redirecting...</p>
    </div>
  );
}
