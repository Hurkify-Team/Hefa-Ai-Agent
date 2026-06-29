"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LockKeyhole, ShieldCheck } from "lucide-react";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [nextPath, setNextPath] = useState("/dashboard");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next?.startsWith("/")) setNextPath(next);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/signin", {
        body: JSON.stringify({ email, password }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await safeJsonResponse<Record<string, any>>(response, "app/sign-in/page.tsx");
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Unable to sign in.");
      router.replace(nextPath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-8 text-slate-950">
      <section className="mx-auto grid min-h-[calc(100vh-64px)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[1fr_440px]">
        <div className="hidden lg:block">
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-blue-600 text-white shadow-[0_18px_50px_rgba(37,99,235,0.28)]">
            <ShieldCheck className="h-7 w-7" />
          </span>
          <h1 className="mt-7 max-w-2xl text-[44px] font-semibold leading-[1.02] tracking-[-0.025em] text-slate-950">HEFAMAA Smart Registry Agent workspace</h1>
          <p className="mt-5 max-w-xl text-[15px] font-semibold leading-7 text-slate-600">
            Sign in to use the department-aware AI workspace. Front Desk users get help desk and search access, while Super Users control the full portal, workbook, cleaning, analytics, and settings power.
          </p>
        </div>

        <form className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.10)]" onSubmit={submit}>
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
            <LockKeyhole className="h-5 w-5" />
          </span>
          <h2 className="mt-5 text-[26px] font-semibold tracking-[-0.02em] text-slate-950">Sign in</h2>
          <p className="mt-1 text-[13px] font-medium text-slate-500">Use your HEFAMAA workspace account.</p>

          <div className="mt-6 space-y-4">
            <label className="block text-[12px] font-medium text-slate-700">
              Email
              <input className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
            </label>
            <label className="block text-[12px] font-medium text-slate-700">
              Password
              <input className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
            </label>
            <div className="text-right">
              <Link className="text-[12px] font-medium text-blue-700 hover:text-blue-800" href="/forgot-password">Forgot password?</Link>
            </div>
          </div>

          {message ? <p className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">{message}</p> : null}

          <button className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-60" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Signing in..." : "Sign in"}
            <ArrowRight className="h-4 w-4" />
          </button>

          <p className="mt-5 text-center text-[12px] font-medium text-slate-500">
            New workspace? <Link className="font-semibold text-blue-700" href="/sign-up">Create the first account</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
