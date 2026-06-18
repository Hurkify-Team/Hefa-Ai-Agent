"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, KeyRound, RotateCcw } from "lucide-react";

type ResetStep = "request" | "confirm" | "done";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [step, setStep] = useState<ResetStep>("request");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function requestReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        body: JSON.stringify({ email }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Unable to create reset code.");
      setResetCode(payload.data.resetCode);
      setStep("confirm");
      setMessage("Reset code generated. For this local MVP, the code is shown below instead of emailed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create reset code.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/reset-password", {
        body: JSON.stringify({ email, password: newPassword, resetCode }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Unable to reset password.");
      setStep("done");
      setMessage("Password reset successfully. You can now sign in with the new password.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reset password.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-8 text-slate-950">
      <section className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-xl items-center">
        <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.10)]">
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
            <RotateCcw className="h-5 w-5" />
          </span>
          <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.02em] text-slate-950">Reset password</h1>
          <p className="mt-1 text-[13px] font-medium leading-6 text-slate-500">
            Generate a local reset code, then set a new password for your HEFAMAA workspace account.
          </p>

          {step === "request" ? (
            <form className="mt-6 space-y-4" onSubmit={requestReset}>
              <label className="block text-[12px] font-medium text-slate-700">
                Account email
                <input className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
              </label>
              <button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-60" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Generating code..." : "Generate reset code"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          ) : null}

          {step === "confirm" ? (
            <form className="mt-6 space-y-4" onSubmit={confirmReset}>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-blue-700">Local reset code</p>
                <p className="mt-2 break-all font-mono text-[15px] font-semibold text-blue-950">{resetCode}</p>
              </div>
              <label className="block text-[12px] font-medium text-slate-700">
                Reset code
                <input className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-[13px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setResetCode(event.target.value)} value={resetCode} />
              </label>
              <label className="block text-[12px] font-medium text-slate-700">
                New password
                <div className="mt-1 flex h-12 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
                  <KeyRound className="h-4 w-4 text-slate-400" />
                  <input className="w-full bg-transparent text-[14px] font-medium outline-none" onChange={(event) => setNewPassword(event.target.value)} type="password" value={newPassword} />
                </div>
              </label>
              <button className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-60" disabled={isSubmitting} type="submit">
                {isSubmitting ? "Resetting password..." : "Reset password"}
                <ArrowRight className="h-4 w-4" />
              </button>
            </form>
          ) : null}

          {message ? <p className="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-bold text-blue-800">{message}</p> : null}

          <p className="mt-5 text-center text-[12px] font-medium text-slate-500">
            {step === "done" ? <Link className="font-semibold text-blue-700" href="/sign-in">Back to sign in</Link> : <Link className="font-semibold text-blue-700" href="/sign-in">Return to sign in</Link>}
          </p>
        </div>
      </section>
    </main>
  );
}
