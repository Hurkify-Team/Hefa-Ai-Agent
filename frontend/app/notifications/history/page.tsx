"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2, RefreshCcw } from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type NotificationLog = { category: string; channel: string; created_at: string; facility_name: string; id: string; lga: string; notification_type: string; provider_response: string; sent_at: string | null; status: string; subject: string };

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json() as ApiResult<T>;
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

function formatDate(value: string | null) {
  if (!value) return "Not sent";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

export default function NotificationHistoryPage() {
  const [logs, setLogs] = useState<NotificationLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function load() {
    setIsLoading(true);
    try {
      const data = await fetchJson<{ logs: NotificationLog[] }>("/api/notifications/history");
      setLogs(data.logs);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load notification history.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <AppShell>
      <section className="min-h-screen bg-[#f6f9ff] px-4 py-6 xl:px-6">
        <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_22px_60px_rgba(15,23,42,0.07)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700"><FileText className="h-4 w-4" /> Notification History</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-slate-950">Email & SMS Delivery Log</h1></div>
            <button className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-3 text-[12px] font-semibold text-white disabled:opacity-60" disabled={isLoading} onClick={() => void load()} type="button">{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Refresh</button>
          </div>
          {message ? <p className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">{message}</p> : null}
        </div>
        <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
          <table className="w-full min-w-[900px] text-left text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-4 py-3">Facility</th><th className="px-4 py-3">Category/LGA</th><th className="px-4 py-3">Channel</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Subject</th><th className="px-4 py-3">Date</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {logs.length ? logs.map((log) => <tr key={log.id}><td className="px-4 py-3 font-semibold text-slate-950">{log.facility_name}</td><td className="px-4 py-3 text-slate-600">{log.category || "-"} · {log.lga || "-"}</td><td className="px-4 py-3 font-semibold uppercase text-blue-700">{log.channel}</td><td className="px-4 py-3 capitalize text-slate-700">{log.status}</td><td className="px-4 py-3 text-slate-600">{log.subject}</td><td className="px-4 py-3 text-slate-500">{formatDate(log.sent_at || log.created_at)}</td></tr>) : <tr><td className="px-4 py-8 text-center text-slate-500" colSpan={6}>No notification history yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </AppShell>
  );
}
