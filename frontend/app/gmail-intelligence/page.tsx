"use client";

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { BarChart3, CheckCircle2, Clock3, Inbox, Loader2, MailCheck, RefreshCw, ShieldCheck, Sparkles } from "lucide-react";

type MailRecord = {
  category: string;
  from: string;
  id: string;
  receivedAt: string;
  snippet: string;
  source: "gmail" | "sample";
  subject: string;
};

type CountRow = { label: string; count: number };
type YearRow = { year: string; count: number };

type GmailPayload = {
  gmail: { configured: boolean; mode: string; note: string };
  mailRecords: MailRecord[];
  summary: {
    categoryCounts: CountRow[];
    configured: boolean;
    latestMailAt: string | null;
    sourceCounts: CountRow[];
    topCategory: CountRow | null;
    totalMailRecords: number;
    yearlyCounts: YearRow[];
  };
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function fetchJson<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as ApiResult<T>;
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function BarList({ rows }: { rows: CountRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="space-y-3">
      {rows.slice(0, 7).map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[12px] font-bold text-slate-600"><span className="truncate">{row.label}</span><span className="text-slate-950">{row.count}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: Math.max(4, (row.count / max) * 100) + "%" }} /></div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ icon: Icon, label, tone, value }: { icon: typeof MailCheck; label: string; tone: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_35px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-3"><p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p><span className={["flex h-9 w-9 items-center justify-center rounded-xl ring-1", tone].join(" ")}><Icon className="h-4 w-4" /></span></div>
      <p className="mt-3 truncate text-2xl font-black tracking-[-0.04em] text-slate-950">{value}</p>
    </div>
  );
}

export default function GmailIntelligencePage() {
  const [data, setData] = useState<GmailPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("Loading Gmail intelligence...");

  const topYear = useMemo(() => {
    const rows = data?.summary.yearlyCounts ?? [];
    return [...rows].sort((a, b) => b.count - a.count)[0] ?? null;
  }, [data]);

  async function loadMail() {
    setIsLoading(true);
    try {
      const nextData = await fetchJson<GmailPayload>("/api/gmail-intelligence/summary");
      setData(nextData);
      setMessage(nextData.gmail.note);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load Gmail intelligence.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadMail();
  }, []);

  return (
    <AppShell>
      <section className="min-h-screen bg-[#f6f9ff] px-4 py-6 xl:px-6 2xl:px-7">
        <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_22px_60px_rgba(15,23,42,0.07)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-blue-700"><MailCheck className="h-4 w-4" /> HEFA-AI Gmail Intelligence</p>
              <h1 className="mt-2 text-[28px] font-black tracking-[-0.03em] text-slate-950">Agency Mail Tracking & Complaint Trends</h1>
              <p className="mt-1 max-w-3xl text-[14px] font-semibold leading-6 text-slate-600">Track agency Gmail correspondence separately from help desk cases, classify mail by category, and monitor yearly communication trends for management reporting.</p>
            </div>
            <button className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-[13px] font-extrabold text-white shadow-[0_14px_30px_rgba(37,99,235,0.24)] transition hover:bg-blue-700" disabled={isLoading} onClick={() => void loadMail()} type="button">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh Mail
            </button>
          </div>
          <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] font-bold text-blue-800">{message}</div>
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <StatCard icon={Inbox} label="Mail Records" tone="bg-blue-50 text-blue-700 ring-blue-100" value={data?.summary.totalMailRecords ?? "-"} />
            <StatCard icon={Sparkles} label="Top Category" tone="bg-indigo-50 text-indigo-700 ring-indigo-100" value={data?.summary.topCategory?.label ?? "-"} />
            <StatCard icon={Clock3} label="Latest Mail" tone="bg-amber-50 text-amber-700 ring-amber-100" value={formatDate(data?.summary.latestMailAt ?? null)} />
            <StatCard icon={CheckCircle2} label="Gmail Status" tone="bg-emerald-50 text-emerald-700 ring-emerald-100" value={data?.gmail.configured ? "Ready" : "Local"} />
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-[16px] font-black text-slate-950"><BarChart3 className="h-5 w-5 text-blue-700" /> Mail Category Trends</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">{topYear ? "Peak " + topYear.year : "No trend"}</span></div>
            <div className="mt-5"><BarList rows={data?.summary.categoryCounts ?? []} /></div>
            <div className="mt-5 rounded-2xl bg-slate-50 p-4"><p className="text-[12px] font-black uppercase tracking-[0.12em] text-slate-500">Source Mix</p><div className="mt-3"><BarList rows={data?.summary.sourceCounts ?? []} /></div></div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-[16px] font-black text-slate-950"><ShieldCheck className="h-5 w-5 text-blue-700" /> Recent Agency Mail</h2><span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-black text-slate-600">Separated from Help Desk</span></div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {(data?.mailRecords ?? []).map((mail) => (
                <article className="rounded-2xl border border-slate-200 bg-slate-50 p-4" key={mail.id}>
                  <div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-100 text-blue-700"><MailCheck className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-[13px] font-black text-slate-950">{mail.subject}</p><p className="mt-1 truncate text-[12px] font-semibold text-slate-500">{mail.from}</p></div></div>
                  <p className="mt-3 line-clamp-2 text-[12px] font-semibold leading-5 text-slate-600">{mail.snippet}</p>
                  <div className="mt-3 flex items-center justify-between gap-2"><span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">{mail.category}</span><span className="text-[11px] font-bold text-slate-400">{formatDate(mail.receivedAt)}</span></div>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
