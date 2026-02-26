"use client";

import { useEffect, useState, type FormEvent } from "react";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth";
import { getFirebaseAuth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function LoginPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [resetError, setResetError] = useState("");

  useEffect(() => {
    if (!loading && user) {
      router.replace("/");
    }
  }, [loading, user, router]);

  if (loading || user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      router.replace("/");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      const friendlyMessages: Record<string, string> = {
        "auth/invalid-credential":      "Incorrect email or password.",
        "auth/user-not-found":          "No account found with this email.",
        "auth/wrong-password":          "Incorrect password.",
        "auth/invalid-email":           "Please enter a valid email address.",
        "auth/user-disabled":           "This account has been disabled.",
        "auth/too-many-requests":       "Too many failed attempts. Please try again later.",
        "auth/network-request-failed":  "Network error. Please check your connection.",
      };
      setError(friendlyMessages[code] ?? (err instanceof Error ? err.message : "Failed to log in."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault();
    setResetError("");
    setResetStatus("sending");
    try {
      await sendPasswordResetEmail(getFirebaseAuth(), resetEmail);
      setResetStatus("sent");
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? "";
      const friendlyMessages: Record<string, string> = {
        "auth/user-not-found":          "No account found with this email.",
        "auth/invalid-email":           "Please enter a valid email address.",
        "auth/too-many-requests":       "Too many requests. Please try again later.",
        "auth/network-request-failed":  "Network error. Please check your connection.",
      };
      setResetError(friendlyMessages[code] ?? (err instanceof Error ? err.message : "Failed to send reset email."));
      setResetStatus("idle");
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <img src='/logo.png' alt='GBA Studio' style={{ height: '120px' }} className="mb-10" />

      <div className="w-full max-w-sm">
        {showReset ? (
          <>
            <h2 className="mb-2 text-2xl font-bold">Reset Password</h2>
            <p className="mb-6 text-sm text-gray-500">
              Enter your email and we&apos;ll send you a reset link.
            </p>

            {resetStatus === "sent" ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
                Check your email for a reset link.
              </div>
            ) : (
              <form onSubmit={handleResetPassword} className="space-y-4">
                <div>
                  <label htmlFor="reset-email" className="mb-1 block text-sm font-medium">
                    Email
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
                  />
                </div>

                {resetError && <p className="text-sm text-red-600">{resetError}</p>}

                <button
                  type="submit"
                  disabled={resetStatus === "sending"}
                  className="w-full rounded-lg bg-accent py-2.5 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
                >
                  {resetStatus === "sending" ? "Sending..." : "Send Reset Email"}
                </button>
              </form>
            )}

            <button
              onClick={() => { setShowReset(false); setResetStatus("idle"); setResetError(""); }}
              className="mt-4 w-full text-center text-sm text-gray-500 hover:text-foreground"
            >
              ← Back to Log In
            </button>
          </>
        ) : (
          <>
            <h2 className="mb-6 text-2xl font-bold">Log In</h2>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label htmlFor="password" className="block text-sm font-medium">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={() => { setShowReset(true); setResetEmail(email); }}
                    className="text-xs text-gray-400 hover:text-accent"
                  >
                    Forgot password?
                  </button>
                </div>
                <input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 outline-none focus:ring-2 focus:ring-accent"
                />
              </div>

              {error && <p className="text-sm text-red-600">{error}</p>}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-accent py-2.5 font-semibold text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Logging in..." : "Log In"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-gray-500">
              Don&apos;t have an account?{" "}
              <Link href="/signup" className="font-medium text-accent hover:underline">
                Sign Up
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
