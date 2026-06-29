"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Clock3,
  Headphones,
  Inbox,
  Loader2,
  MessageSquareText,
  PhoneCall,
  Send,
  ShieldCheck,
  UserRound,
  Workflow,
} from "lucide-react";

type Ticket = {
  assignedUnit: string;
  category: string;
  channel: "email" | "letter" | "walk_in" | "phone" | "portal";
  contactPhone?: string;
  createdAt: string;
  dueAt: string;
  facilityName?: string;
  id: string;
  message: string;
  priority: "low" | "normal" | "high";
  senderEmail?: string;
  senderName: string;
  slaHours: number;
  slaStatus: "on_track" | "due_soon" | "breached" | "resolved";
  status: "open" | "in_review" | "resolved";
  subject: string;
  updatedAt: string;
};

type CountRow = { label: string; count: number };

type Summary = {
  breachedTickets: number;
  categoryCounts: CountRow[];
  channelCounts: CountRow[];
  dueToday: number;
  highPriorityTickets: number;
  openTickets: number;
  priorityCounts: Record<string, number>;
  resolvedTickets: number;
  slaCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  totalTickets: number;
  unitCounts: CountRow[];
};

type HelpDeskPayload = { summary: Summary; ticket?: Ticket; tickets: Ticket[] };
type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

const channelOptions = [
  { label: "Walk In", value: "walk_in" },
  { label: "Phone", value: "phone" },
  { label: "Letter", value: "letter" },
  { label: "Portal", value: "portal" },
  { label: "Email", value: "email" },
] as const;

const unitOptions = [
  "Front Desk",
  "Facility Registry",
  "Licensing Unit",
  "Monitoring & Inspection",
  "Compliance & Enforcement",
  "Accounts & Revenue",
  "ICT / Portal Support",
];

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function toneClass(value: Ticket["priority"] | Ticket["slaStatus"] | Ticket["status"]) {
  if (value === "high" || value === "breached") return "bg-rose-50 text-rose-700 ring-rose-100";
  if (value === "normal" || value === "due_soon" || value === "in_review") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (value === "resolved") return "bg-emerald-50 text-emerald-700 ring-emerald-100";
  return "bg-blue-50 text-blue-700 ring-blue-100";
}

function labelize(value: string) {
  return value.replace(/_/g, " ");
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "app/help-desk/page.tsx"));
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

function StatCard({ icon: Icon, label, tone, value }: { icon: typeof Headphones; label: string; tone: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_35px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
        <span className={["flex h-9 w-9 items-center justify-center rounded-xl ring-1", tone].join(" ")}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-3xl font-black tracking-[-0.04em] text-slate-950">{value}</p>
    </div>
  );
}

function BarList({ rows }: { rows: CountRow[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <div className="space-y-3">
      {rows.slice(0, 6).map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[12px] font-bold text-slate-600"><span className="truncate">{row.label}</span><span className="text-slate-950">{row.count}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: Math.max(4, (row.count / max) * 100) + "%" }} /></div>
        </div>
      ))}
    </div>
  );
}

export default function HelpDeskPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [form, setForm] = useState({ assignedUnit: "", channel: "walk_in", contactPhone: "", facilityName: "", message: "", senderEmail: "", senderName: "", subject: "" });

  const activeTickets = useMemo(() => tickets.filter((ticket) => ticket.status !== "resolved"), [tickets]);
  const topUnit = summary?.unitCounts[0];

  async function loadHelpDesk() {
    setIsLoading(true);
    try {
      const data = await fetchJson<HelpDeskPayload>("/api/help-desk/tickets");
      setTickets(data.tickets);
      setSummary(data.summary);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load help desk records.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadHelpDesk();
  }, []);

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    try {
      const data = await fetchJson<HelpDeskPayload>("/api/help-desk/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setTickets(data.tickets);
      setSummary(data.summary);
      setForm({ assignedUnit: "", channel: "walk_in", contactPhone: "", facilityName: "", message: "", senderEmail: "", senderName: "", subject: "" });
      setMessage("Help desk case saved, categorised, routed, and assigned an SLA by HEFA-AI.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save help desk record.");
    } finally {
      setIsSaving(false);
    }
  }

  async function updateStatus(id: string, status: Ticket["status"]) {
    setUpdatingId(id);
    try {
      const data = await fetchJson<HelpDeskPayload>("/api/help-desk/tickets", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      setTickets(data.tickets);
      setSummary(data.summary);
      setMessage("Help desk case updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update ticket.");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <AppShell>
      <section className="min-h-screen bg-[#f6f9ff] px-4 py-6 xl:px-6 2xl:px-7">
        <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_22px_60px_rgba(15,23,42,0.07)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.2em] text-blue-700"><Headphones className="h-4 w-4" /> HEFA-AI Help Desk</p>
              <h1 className="mt-2 text-[28px] font-black tracking-[-0.03em] text-slate-950">Reception, Complaints & Agency Case Desk</h1>
              <p className="mt-1 max-w-3xl text-[14px] font-semibold leading-6 text-slate-600">Capture walk-ins, calls, letters, portal support requests, and public complaints with automatic category, priority, responsible unit, and SLA tracking.</p>
            </div>
            <button className="inline-flex h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 text-[13px] font-extrabold text-white shadow-[0_14px_30px_rgba(37,99,235,0.24)] transition hover:bg-blue-700" disabled={isLoading} onClick={() => void loadHelpDesk()} type="button">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Inbox className="h-4 w-4" />}
              Refresh Desk
            </button>
          </div>
          {message ? <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] font-bold text-blue-800">{message}</div> : null}
          <div className="mt-5 grid gap-4 md:grid-cols-4">
            <StatCard icon={Inbox} label="Open Cases" tone="bg-blue-50 text-blue-700 ring-blue-100" value={summary?.openTickets ?? "-"} />
            <StatCard icon={AlertTriangle} label="High Priority" tone="bg-rose-50 text-rose-700 ring-rose-100" value={summary?.highPriorityTickets ?? "-"} />
            <StatCard icon={Clock3} label="Due Soon" tone="bg-amber-50 text-amber-700 ring-amber-100" value={summary?.dueToday ?? "-"} />
            <StatCard icon={CheckCircle2} label="Resolved" tone="bg-emerald-50 text-emerald-700 ring-emerald-100" value={summary?.resolvedTickets ?? "-"} />
          </div>
        </div>

        <div className="mt-5 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
          <form className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]" onSubmit={submitTicket}>
            <div className="flex items-center gap-2"><MessageSquareText className="h-5 w-5 text-blue-700" /><h2 className="text-[16px] font-black text-slate-950">New Agency Case</h2></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-[12px] font-extrabold text-slate-600">Requester Name<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, senderName: event.target.value }))} required value={form.senderName} /></label>
              <label className="text-[12px] font-extrabold text-slate-600">Requester Email<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, senderEmail: event.target.value }))} type="email" value={form.senderEmail} /></label>
              <label className="text-[12px] font-extrabold text-slate-600">Phone<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, contactPhone: event.target.value }))} value={form.contactPhone} /></label>
              <label className="text-[12px] font-extrabold text-slate-600">Facility / Organisation<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, facilityName: event.target.value }))} value={form.facilityName} /></label>
            </div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[150px_1fr]">
              <label className="text-[12px] font-extrabold text-slate-600">Channel<select className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, channel: event.target.value }))} value={form.channel}>{channelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="text-[12px] font-extrabold text-slate-600">Subject<input className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, subject: event.target.value }))} required value={form.subject} /></label>
            </div>
            <label className="mt-3 block text-[12px] font-extrabold text-slate-600">Preferred Unit<select className="mt-1 h-11 w-full rounded-xl border border-slate-200 px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, assignedUnit: event.target.value }))} value={form.assignedUnit}><option value="">HEFA-AI should route this case</option>{unitOptions.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
            <label className="mt-3 block text-[12px] font-extrabold text-slate-600">Case Details<textarea className="mt-1 min-h-36 w-full rounded-xl border border-slate-200 p-3 text-[13px] font-semibold leading-6 outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50" onChange={(event) => setForm((current) => ({ ...current, message: event.target.value }))} required value={form.message} /></label>
            <button className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-[13px] font-extrabold text-white shadow-[0_14px_30px_rgba(37,99,235,0.22)] transition hover:bg-blue-700 disabled:opacity-60" disabled={isSaving} type="submit">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Save, Route & Track SLA</button>
          </form>

          <div className="space-y-5">
            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
              <div className="flex items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-[16px] font-black text-slate-950"><Workflow className="h-5 w-5 text-blue-700" /> Active Case Queue</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-700 ring-1 ring-blue-100">{activeTickets.length} active</span></div>
              <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
                {tickets.length ? tickets.slice(0, 10).map((ticket) => (
                  <article className="p-4" key={ticket.id}>
                    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[14px] font-black text-slate-950">{ticket.subject}</p><p className="mt-1 text-[12px] font-semibold text-slate-500">{ticket.senderName} · {ticket.facilityName || "No facility linked"}</p></div><div className="flex flex-wrap gap-2"><span className={["rounded-full px-2.5 py-1 text-[11px] font-black capitalize ring-1", toneClass(ticket.priority)].join(" ")}>{ticket.priority}</span><span className={["rounded-full px-2.5 py-1 text-[11px] font-black capitalize ring-1", toneClass(ticket.slaStatus)].join(" ")}>{labelize(ticket.slaStatus)}</span></div></div>
                    <p className="mt-2 line-clamp-2 text-[13px] font-semibold leading-6 text-slate-600">{ticket.message}</p>
                    <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{ticket.category}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{ticket.assignedUnit}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">Due {formatDate(ticket.dueAt)}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{labelize(ticket.status)}</span></div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-white px-3 text-[12px] font-extrabold text-blue-700 hover:bg-blue-50 disabled:opacity-50" disabled={updatingId === ticket.id || ticket.status === "in_review" || ticket.status === "resolved"} onClick={() => void updateStatus(ticket.id, "in_review")} type="button"><ShieldCheck className="h-3.5 w-3.5" /> In Review</button>
                      <button className="inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-[12px] font-extrabold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50" disabled={updatingId === ticket.id || ticket.status === "resolved"} onClick={() => void updateStatus(ticket.id, "resolved")} type="button"><CheckCircle2 className="h-3.5 w-3.5" /> Resolve</button>
                    </div>
                  </article>
                )) : <p className="p-4 text-[13px] font-semibold text-slate-500">No help desk records yet.</p>}
              </div>
            </section>

            <section className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]"><h2 className="flex items-center gap-2 text-[16px] font-black text-slate-950"><Building2 className="h-5 w-5 text-blue-700" /> Unit Workload</h2><div className="mt-4"><BarList rows={summary?.unitCounts ?? []} /></div></div>
              <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]"><h2 className="flex items-center gap-2 text-[16px] font-black text-slate-950"><PhoneCall className="h-5 w-5 text-blue-700" /> Operational Insight</h2><div className="mt-4 rounded-2xl bg-blue-50 p-4 text-[13px] font-bold leading-6 text-blue-900">{topUnit ? topUnit.label + " currently has the highest help desk workload. Prioritise breached and high priority cases first." : "No workload trend yet. Add help desk cases to activate routing insight."}</div><div className="mt-3"><BarList rows={summary?.categoryCounts ?? []} /></div></div>
            </section>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
