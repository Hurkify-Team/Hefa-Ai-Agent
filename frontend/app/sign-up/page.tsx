"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ShieldPlus } from "lucide-react";

import { teamRoles } from "@/lib/authAccess";
import type { TeamRole } from "@/types/auth";

export default function SignUpPage() {
  const router = useRouter();
  const [department, setDepartment] = useState("Super Administration");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<TeamRole>("Super User");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/signup", {
        body: JSON.stringify({ department, email, name, password, role }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Unable to create account.");
      router.replace("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create account.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f8fb] px-4 py-8 text-slate-950">
      <section className="mx-auto flex min-h-[calc(100vh-64px)] w-full max-w-xl items-center">
        <form className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_20px_70px_rgba(15,23,42,0.10)]" onSubmit={submit}>
          <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white">
            <ShieldPlus className="h-5 w-5" />
          </span>
          <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.02em] text-slate-950">Create workspace account</h1>
          <p className="mt-1 text-[13px] font-medium leading-6 text-slate-500">
            For setup, choose Super User to unlock the full workspace. Later we can restrict public signup and assign department roles from Users & Roles.
          </p>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="block text-[12px] font-medium text-slate-700 sm:col-span-2">
              Full name
              <input className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setName(event.target.value)} value={name} />
            </label>
            <label className="block text-[12px] font-medium text-slate-700">
              Email
              <input className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setEmail(event.target.value)} type="email" value={email} />
            </label>
            <label className="block text-[12px] font-medium text-slate-700">
              Department
              <input className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setDepartment(event.target.value)} value={department} />
            </label>
            <label className="block text-[12px] font-medium text-slate-700 sm:col-span-2">
              Workspace role
              <select className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setRole(event.target.value as TeamRole)} value={role}>
                {teamRoles.map((item) => <option key={item}>{item}</option>)}
              </select>
            </label>
            <label className="block text-[12px] font-medium text-slate-700 sm:col-span-2">
              Password
              <input className="mt-1 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-[14px] font-medium outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setPassword(event.target.value)} type="password" value={password} />
              <span className="mt-1 block text-[11px] font-normal text-slate-400">Use at least 8 characters.</span>
            </label>
          </div>

          {message ? <p className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[12px] font-bold text-rose-700">{message}</p> : null}

          <button className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[14px] font-medium text-white hover:bg-blue-700 disabled:opacity-60" disabled={isSubmitting} type="submit">
            {isSubmitting ? "Creating account..." : "Create account"}
            <ArrowRight className="h-4 w-4" />
          </button>

          <p className="mt-5 text-center text-[12px] font-medium text-slate-500">
            Already have an account? <Link className="font-semibold text-blue-700" href="/sign-in">Sign in</Link>
          </p>
        </form>
      </section>
    </main>
  );
}
