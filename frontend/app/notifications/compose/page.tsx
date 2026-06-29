"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { FormEvent, useMemo, useState } from "react";
import { Loader2, MailCheck, Send, Smartphone, UsersRound } from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type Channel = "email" | "sms";
type NotificationType = "pending_requirements" | "expired_accreditation" | "missing_documents" | "inspection_reminder" | "general_notice" | "incomplete_record" | "provisional_license_ready";
type Recipient = { category: string; contact_email: string; contact_phone: string; facility_name: string; id: string; lga: string; portal_status: string; reason: string };
type Preview = { logs?: unknown[]; recipientCount: number; recipients: Recipient[]; requiresConfirmation: boolean };

const notificationTypes: Array<{ label: string; value: NotificationType }> = [
  { label: "Pending requirements", value: "pending_requirements" },
  { label: "Missing documents", value: "missing_documents" },
  { label: "Inspection reminder", value: "inspection_reminder" },
  { label: "Expired accreditation", value: "expired_accreditation" },
  { label: "Incomplete records", value: "incomplete_record" },
  { label: "Provisional license ready", value: "provisional_license_ready" },
  { label: "General notice", value: "general_notice" },
];

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await safeJsonResponse<ApiResult<T>>(response, "app/notifications/compose/page.tsx");
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

export default function NotificationComposePage() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isWorking, setIsWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ category: "", customMessage: "", customSubject: "", deadline: "7 days", email: true, facilityQuery: "", forceSend: false, lga: "", notificationType: "pending_requirements" as NotificationType, sms: false, status: "" });
  const channels = useMemo<Channel[]>(() => [form.email ? "email" : null, form.sms ? "sms" : null].filter(Boolean) as Channel[], [form.email, form.sms]);

  function body(extra: Record<string, unknown> = {}) {
    return { ...form, channels: channels.length ? channels : ["email"], selectedRecipientIds: selectedIds.size ? [...selectedIds] : undefined, ...extra };
  }

  async function previewTargets(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsWorking(true);
    try {
      const result = await fetchJson<Preview>("/api/notifications/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body()) });
      setPreview(result);
      setSelectedIds(new Set(result.recipients.map((recipient) => recipient.id)));
      setNotice(result.recipientCount + " recipient(s) matched. Confirm Send is still required.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to preview recipients.");
    } finally {
      setIsWorking(false);
    }
  }

  async function confirmSend() {
    setIsWorking(true);
    try {
      const result = await fetchJson<Preview>("/api/notifications/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body({ confirmed: true })) });
      setPreview(result);
      setNotice((result.logs?.length ?? 0) + " notification log item(s) created.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send notifications.");
    } finally {
      setIsWorking(false);
    }
  }

  function toggle(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <AppShell>
      <section className="min-h-screen bg-[#f6f9ff] px-4 py-6 xl:px-6">
        <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_22px_60px_rgba(15,23,42,0.07)]"><p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700">HEFA-AI Notification Compose</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-slate-950">Preview Recipients Before Sending</h1><p className="mt-1 text-[14px] font-medium text-slate-600">Select a rule, preview the matched facilities, then confirm email/SMS delivery.</p>{notice ? <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-700">{notice}</p> : null}</div>
        <div className="mt-5 grid gap-5 xl:grid-cols-[0.75fr_1.25fr]">
          <form className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]" onSubmit={previewTargets}>
            <h2 className="flex items-center gap-2 text-[16px] font-semibold text-slate-950"><MailCheck className="h-5 w-5 text-blue-700" /> Compose</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-[12px] font-semibold text-slate-600">Facility<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px]" onChange={(event) => setForm((current) => ({ ...current, facilityQuery: event.target.value }))} value={form.facilityQuery} /></label><label className="text-[12px] font-semibold text-slate-600">Category<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px]" onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} value={form.category} /></label><label className="text-[12px] font-semibold text-slate-600">LGA<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px]" onChange={(event) => setForm((current) => ({ ...current, lga: event.target.value }))} value={form.lga} /></label><label className="text-[12px] font-semibold text-slate-600">Status<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px]" onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))} value={form.status} /></label></div>
            <label className="mt-3 block text-[12px] font-semibold text-slate-600">Type<select className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px]" onChange={(event) => setForm((current) => ({ ...current, notificationType: event.target.value as NotificationType }))} value={form.notificationType}>{notificationTypes.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
            <label className="mt-3 block text-[12px] font-semibold text-slate-600">Custom message<textarea className="mt-1 min-h-28 w-full rounded-xl border border-slate-200 p-3 text-[13px]" onChange={(event) => setForm((current) => ({ ...current, customMessage: event.target.value }))} value={form.customMessage} /></label>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[13px] font-semibold"><input checked={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.checked }))} type="checkbox" /> <MailCheck className="h-4 w-4 text-blue-700" /> Email</label><label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[13px] font-semibold"><input checked={form.sms} onChange={(event) => setForm((current) => ({ ...current, sms: event.target.checked }))} type="checkbox" /> <Smartphone className="h-4 w-4 text-blue-700" /> SMS</label><label className="flex h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[13px] font-semibold"><input checked={form.forceSend} onChange={(event) => setForm((current) => ({ ...current, forceSend: event.target.checked }))} type="checkbox" /> Send anyway</label></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><button className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-[13px] font-semibold text-white disabled:opacity-60" disabled={isWorking} type="submit">{isWorking ? <Loader2 className="h-4 w-4 animate-spin" /> : <UsersRound className="h-4 w-4" />} Preview</button><button className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-[13px] font-semibold text-blue-700 disabled:opacity-60" disabled={isWorking || !preview?.recipients.length} onClick={() => void confirmSend()} type="button"><Send className="h-4 w-4" /> Confirm Send</button></div>
          </form>
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]"><div className="flex items-center justify-between gap-3"><h2 className="text-[16px] font-semibold text-slate-950">Recipient Preview</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700">{preview?.recipientCount ?? 0} matched</span></div><div className="mt-4 grid gap-3">{preview?.recipients.length ? preview.recipients.slice(0, 40).map((recipient) => <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4" key={recipient.id}><label className="flex items-start gap-3"><input checked={selectedIds.has(recipient.id)} className="mt-1" onChange={() => toggle(recipient.id)} type="checkbox" /><span><span className="block text-[13px] font-semibold text-slate-950">{recipient.facility_name}</span><span className="mt-1 block text-[12px] font-medium text-slate-500">{recipient.category || "No category"} · {recipient.lga || "No LGA"}</span><span className="mt-2 block text-[12px] font-medium text-slate-600">{recipient.reason}</span><span className="mt-2 block text-[11px] font-semibold text-slate-500">{recipient.contact_email || "No email"} · {recipient.contact_phone || "No phone"}</span></span></label></article>) : <p className="rounded-2xl border border-dashed border-slate-200 p-5 text-[13px] font-medium text-slate-500">Run preview to see recipients.</p>}</div></section>
        </div>
      </section>
    </AppShell>
  );
}
