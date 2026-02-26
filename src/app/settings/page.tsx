"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { useTheme } from "@/lib/theme-context";
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const router = useRouter();

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwStatus, setPwStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [pwError, setPwError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  const hasPasswordProvider = user?.providerData.some(
    (p) => p.providerId === "password"
  );

  const handleChangePassword = async () => {
    if (!user || !user.email) return;
    setPwError("");
    if (newPw !== confirmPw) {
      setPwError("New passwords don't match");
      return;
    }
    if (newPw.length < 6) {
      setPwError("New password must be at least 6 characters");
      return;
    }
    setPwStatus("loading");
    try {
      const credential = EmailAuthProvider.credential(user.email, currentPw);
      await reauthenticateWithCredential(user, credential);
      await updatePassword(user, newPw);
      setPwStatus("success");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
      setTimeout(() => setPwStatus("idle"), 3000);
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setPwError("Current password is incorrect");
      } else if (code === "auth/weak-password") {
        setPwError("Password must be at least 6 characters");
      } else {
        setPwError("Failed to update password. Please try again.");
      }
      setPwStatus("error");
    }
  };

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const displayName =
    user.displayName || user.email?.split("@")[0] || "—";

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      {/* Nav */}
      <nav className="flex items-center gap-6 border-b border-gray-200 bg-white px-6 py-4">
        <img src="/logo.png" alt="GBA Studio" style={{ height: "48px" }} />
        <Link href="/" className="text-sm text-gray-500 hover:text-foreground">
          ← Back to Projects
        </Link>
      </nav>

      <main className="flex flex-1 flex-col items-center px-4 py-12">
        <div className="w-full max-w-lg space-y-6">
          <h1 className="text-3xl font-ahsing text-foreground">Settings</h1>

          {/* Appearance */}
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-5 text-xl font-ahsing text-foreground">Appearance</h2>

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700">Theme</p>
                <p className="mt-0.5 text-sm text-gray-500">
                  {theme === "dark" ? "Dark mode" : "Light mode"}
                </p>
              </div>

              {/* Toggle switch */}
              <button
                onClick={toggleTheme}
                aria-label="Toggle dark mode"
                className="relative inline-flex h-7 w-14 flex-shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2"
                style={{
                  backgroundColor: theme === "dark" ? "#2563EB" : "#d1d5db",
                }}
              >
                <span
                  className="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform duration-200"
                  style={{
                    transform:
                      theme === "dark" ? "translateX(28px)" : "translateX(4px)",
                  }}
                />
              </button>
            </div>

            <p className="mt-3 text-xs text-gray-400">
              Your preference is saved locally and applied across the app.
            </p>
          </section>

          {/* Account */}
          <section className="rounded-xl border border-gray-200 bg-white p-6">
            <h2 className="mb-5 text-xl font-ahsing text-foreground">Account</h2>

            <dl className="mb-6 divide-y divide-gray-100">
              <div className="flex items-center justify-between py-3">
                <dt className="text-sm text-gray-500">Username</dt>
                <dd className="text-sm font-medium text-gray-700">{displayName}</dd>
              </div>
              <div className="flex items-center justify-between py-3">
                <dt className="text-sm text-gray-500">Email</dt>
                <dd className="text-sm font-medium text-gray-700">{user.email}</dd>
              </div>
            </dl>

            {hasPasswordProvider && (
              <div>
                <h3 className="mb-3 text-sm font-semibold text-gray-700">
                  Change Password
                </h3>
                <div className="space-y-3">
                  <input
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    placeholder="Current password"
                    disabled={pwStatus === "loading"}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="New password"
                    disabled={pwStatus === "loading"}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                  <input
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    placeholder="Confirm new password"
                    disabled={pwStatus === "loading"}
                    onKeyDown={(e) => e.key === "Enter" && handleChangePassword()}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-accent"
                  />

                  {pwError && (
                    <p className="text-sm text-red-500">{pwError}</p>
                  )}
                  {pwStatus === "success" && (
                    <p className="text-sm text-green-600">
                      Password updated successfully.
                    </p>
                  )}

                  <button
                    onClick={handleChangePassword}
                    disabled={
                      pwStatus === "loading" ||
                      !currentPw ||
                      !newPw ||
                      !confirmPw
                    }
                    className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {pwStatus === "loading" ? "Updating..." : "Update Password"}
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
