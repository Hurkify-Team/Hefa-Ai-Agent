"use client";

import { FormEvent, useEffect, useState } from "react";
import { Loader2, Plus, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Rule = { category: string; channel: string[]; condition_field: string; condition_operator: string; condition_value: string; frequency: string; id: string; is_active: boolean; lga: string; rule_name: string; template_id: string; trigger_type: string };

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json() as ApiResult<T>;
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

export default function NotificationRulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ rule_name: "Pending requirements reminder", trigger_type: "pending_requirements", condition_field: "requirements_status", condition_operator: "contains", condition_value: "pending", frequency: "weekly", category: "", lga: "" });

  async function load() {
    const data = await fetchJson<{ rules: Rule[] }>("/api/notifications/rules");
    setRules(data.rules);
  }

  useEffect(() => { void load(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      await fetchJson<{ rule: Rule }>("/api/notifications/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, channel: ["email", "sms"], is_active: true, template_id: "pending_requirements_email" }) });
      await load();
      setMessage("Rule saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save rule.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <AppShell>
      <section className="min-h-screen bg-[#f6f9ff] px-4 py-6 xl:px-6">
        <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_22px_60px_rgba(15,23,42,0.07)]"><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700"><ShieldCheck className="h-4 w-4" /> Notification Rules</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-slate-950">Automated Reminder Rules</h1><p className="mt-1 text-[14px] font-medium text-slate-600">Rules define who should receive reminders. Actual sending still requires preview and confirmation.</p>{message ? <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-700">{message}</p> : null}</div>
        <div className="mt-5 grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
          <form className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]" onSubmit={submit}><h2 className="text-[16px] font-semibold text-slate-950">Create Rule</h2>{Object.entries(form).map(([key, value]) => <label className="mt-3 block text-[12px] font-semibold text-slate-600" key={key}>{key.replace(/_/g, " ")}<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, [key]: event.target.value }))} value={value} /></label>)}<button className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-[13px] font-semibold text-white disabled:opacity-60" disabled={isSaving} type="submit">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Save Rule</button></form>
          <div className="space-y-3">{rules.map((rule) => <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" key={rule.id}><div className="flex items-start justify-between gap-3"><div><p className="text-[14px] font-semibold text-slate-950">{rule.rule_name}</p><p className="mt-1 text-[12px] font-medium text-slate-500">{rule.trigger_type} · {rule.condition_field} {rule.condition_operator} {rule.condition_value}</p></div><span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700">{rule.frequency}</span></div></article>)}</div>
        </div>
      </section>
    </AppShell>
  );
}
