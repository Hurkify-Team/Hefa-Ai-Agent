"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BellRing,
  ClipboardCheck,
  Clock3,
  Eye,
  FileText,
  SearchCheck,
  Loader2,
  MailCheck,
  MailWarning,
  PhoneOff,
  RefreshCcw,
  Send,
  Smartphone,
  ShieldCheck,
  Sparkles,
  UserCheck,
  UsersRound,
  XCircle,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type NotificationLog = { channel: string; created_at: string; facility_name: string; id: string; notification_type: string; sent_at: string | null; status: string; subject: string };
type AttentionCard = { count: number; facilityReminderCount: number; key: string; label: string; lastActivityDate: string | null; oldestPendingDate: string | null; staffActionCount: number; viewHref: string };
type IntelligenceRow = Record<string, unknown>;
type DeliveryStats = {
  recipientCount: number;
  requestedChannels: string[];
  emailReadyCount: number;
  smsReadyCount: number;
  missingEmailCount: number;
  missingPhoneCount: number;
  deliverableMessageCount: number;
  missingDestinationCount: number;
  byStatus: Array<{
    key: string;
    label: string;
    recipientCount: number;
    emailReadyCount: number;
    smsReadyCount: number;
    missingEmailCount: number;
    missingPhoneCount: number;
    deliverableMessageCount: number;
    missingDestinationCount: number;
  }>;
};
type NotificationIntelligence = {
  attentionCards: AttentionCard[];
  backgroundVerificationCount: number;
  changedAfterVerificationCount: number;
  delivery: DeliveryStats;
  evaluatedCount: number;
  generatedAt: string;
  hefamaaAttention: IntelligenceRow[];
  hefamaaAttentionCount: number;
  reminderQueue: IntelligenceRow[];
  reminderQueueCount: number;
  renewalOverdueCount: number;
  staleCacheBlockedCount: number;
  staleCacheCount: number;
};
type NotificationSummary = {
  availableProviders: { activeEmailProvider?: string; emailWebhook: boolean; gmailSmtp: boolean; resend: boolean; smsWebhook: boolean; termii: boolean };
  channelStatusCounts?: Record<string, Record<string, number>>;
  facilitiesRequiringAttention: number;
  intelligence: NotificationIntelligence;
  outboxCount: number;
  recentMessages: NotificationLog[];
  scheduler: { activeRules: number };
  totalFailed: number;
  totalPending: number;
  totalResolved: number;
  totalSent: number;
};
type ResolveFailedResult = { byChannel: Record<string, number>; channel: string; resolved: number; resolvedAt: string; statusCounts: Record<string, number> };
type StatusFacilitiesResult = { count: number; delivery: DeliveryStats; owner: string; rows: IntelligenceRow[]; status: string };
type ReminderSendResult = { delivery?: DeliveryStats; logs?: Array<{ status: string }>; preview?: { recipientCount: number; staleCacheBlocked: number; delivery?: DeliveryStats }; summary: string };
type ContactSourcingResult = { ambiguous: number; emailFound: number; missingTargets: number; notFound: number; phoneFound: number; scannedTargets: number; skipped: number; updated: number };
type DashboardIcon = typeof BellRing;

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await safeJsonResponse<ApiResult<T>>(response, "app/notifications/page.tsx");
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });
}

function formatShortDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-NG", { dateStyle: "medium" });
}

function formatNumber(value: number | undefined) {
  return typeof value === "number" ? value.toLocaleString() : "-";
}

function rowText(row: IntelligenceRow, key: string) {
  const value = row[key];
  return value === null || value === undefined || value === "" ? "" : String(value);
}

function rowBool(row: IntelligenceRow, key: string) {
  return row[key] === true || row[key] === "true";
}

function sendSummaryText(result: ReminderSendResult) {
  const sent = result.logs?.filter((log) => log.status === "sent").length ?? 0;
  const failed = result.logs?.filter((log) => log.status === "failed").length ?? 0;
  const delivery = result.delivery ?? result.preview?.delivery;
  const contactText = delivery
    ? " Email ready: " + delivery.emailReadyCount.toLocaleString() + ". SMS ready: " + delivery.smsReadyCount.toLocaleString() + ". Missing email: " + delivery.missingEmailCount.toLocaleString() + ". Missing phone: " + delivery.missingPhoneCount.toLocaleString() + "."
    : "";
  return result.summary + " Sent: " + sent.toLocaleString() + ". Failed: " + failed.toLocaleString() + "." + contactText;
}

function StatCard({ icon: Icon, label, value }: { icon: DashboardIcon; label: string; value: string | number }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_16px_35px_rgba(15,23,42,0.05)]">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-100"><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-3xl font-semibold tracking-[-0.03em] text-slate-950">{value}</p>
    </article>
  );
}

function QueueMetric({ icon: Icon, label, tone, value }: { icon: DashboardIcon; label: string; tone: "blue" | "amber" | "emerald" | "rose"; value: number | undefined }) {
  const styles = {
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    blue: "bg-blue-50 text-blue-700 ring-blue-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    rose: "bg-rose-50 text-rose-700 ring-rose-100",
  }[tone];
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-semibold text-slate-600">{label}</span>
        <span className={"flex h-8 w-8 items-center justify-center rounded-xl ring-1 " + styles}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-[-0.03em] text-slate-950">{formatNumber(value)}</p>
    </div>
  );
}

function AttentionCardView({ card, isActive, onView }: { card: AttentionCard; isActive: boolean; onView: (card: AttentionCard) => void }) {
  return (
    <article className={(isActive ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200") + " rounded-2xl border bg-white p-4 shadow-[0_14px_35px_rgba(15,23,42,0.04)]"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-slate-950">{card.label}</p>
          <p className="mt-1 text-[11px] font-medium text-slate-500">Portal status monitor</p>
        </div>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-semibold text-blue-700 ring-1 ring-blue-100">{formatNumber(card.count)}</span>
      </div>
      <dl className="mt-4 grid gap-2 text-[12px]">
        <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Oldest Pending</dt><dd className="font-semibold text-slate-900">{formatShortDate(card.oldestPendingDate)}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Last Activity</dt><dd className="font-semibold text-slate-900">{formatShortDate(card.lastActivityDate)}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Facility Reminders</dt><dd className="font-semibold text-amber-700">{formatNumber(card.facilityReminderCount)}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">HEFAMAA Action</dt><dd className="font-semibold text-blue-700">{formatNumber(card.staffActionCount)}</dd></div>
      </dl>
      <button className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-[12px] font-semibold text-blue-700 hover:bg-blue-100" onClick={() => onView(card)} type="button">
        <Eye className="h-4 w-4" /> View Facilities
      </button>
    </article>
  );
}

function MiniTable({ emptyText, rows }: { emptyText: string; rows: IntelligenceRow[] }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200">
      {rows.length ? rows.slice(0, 5).map((row, index) => (
        <article className="border-b border-slate-100 bg-white p-3 last:border-b-0" key={(rowText(row, "Recipient ID") || rowText(row, "Facility Name") || "mini-row") + "-" + index}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-slate-950">{String(row["Facility Name"] ?? "Unknown facility")}</p>
              <p className="mt-1 text-[11px] font-medium text-slate-500">{String(row.Status ?? "No status")} | {String(row.Category ?? "No category")}</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold capitalize text-slate-600">{String(row["Next Action Owner"] ?? "unknown")}</span>
          </div>
          <dl className="mt-3 grid gap-2 text-[11px] font-medium text-slate-500 sm:grid-cols-3">
            <div><dt className="uppercase tracking-[0.08em] text-slate-400">HEF No</dt><dd className="mt-0.5 font-semibold text-slate-700">{String(row["HEF/NO / Portal ID"] || "-")}</dd></div>
            <div><dt className="uppercase tracking-[0.08em] text-slate-400">Days Pending</dt><dd className="mt-0.5 font-semibold text-slate-700">{String(row["Days Pending"] ?? "-")}</dd></div>
            <div><dt className="uppercase tracking-[0.08em] text-slate-400">Next Reminder</dt><dd className="mt-0.5 font-semibold text-slate-700">{formatShortDate(String(row["Next Reminder At"] || ""))}</dd></div>
          </dl>
        </article>
      )) : <p className="bg-white p-4 text-[13px] font-medium text-slate-500">{emptyText}</p>}
    </div>
  );
}

export default function NotificationsPage() {
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [selectedCard, setSelectedCard] = useState<AttentionCard | null>(null);
  const [selectedListMode, setSelectedListMode] = useState<"status" | "queue" | null>(null);
  const [selectedListTitle, setSelectedListTitle] = useState("");
  const [statusFacilities, setStatusFacilities] = useState<StatusFacilitiesResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingFacilities, setIsLoadingFacilities] = useState(false);
  const [isRunningReminders, setIsRunningReminders] = useState(false);
  const [isResolvingFailures, setIsResolvingFailures] = useState(false);
  const [isSourcingContacts, setIsSourcingContacts] = useState(false);
  const [isStartingPortalScan, setIsStartingPortalScan] = useState<"quick" | "full" | null>(null);
  const [sendingRecipientId, setSendingRecipientId] = useState<string | null>(null);
  const [sendingAllStatus, setSendingAllStatus] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reminderMessage, setReminderMessage] = useState("");
  const facilityListRef = useRef<HTMLDivElement>(null);

  async function load() {
    setIsLoading(true);
    try {
      setSummary(await fetchJson<NotificationSummary>("/api/notifications/summary"));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load notification dashboard.");
    } finally {
      setIsLoading(false);
    }
  }

  function focusFacilityList() {
    window.setTimeout(() => facilityListRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  async function loadStatusFacilities(card: AttentionCard) {
    setSelectedCard(card);
    setSelectedListMode("status");
    setSelectedListTitle(card.label + " Facilities");
    setStatusFacilities(null);
    setIsLoadingFacilities(true);
    setMessage("Loading " + card.label.toLowerCase() + " facilities...");
    focusFacilityList();
    try {
      const params = new URLSearchParams({ list: "facilities", owner: "all", status: card.key, limit: "20000" });
      setStatusFacilities(await fetchJson<StatusFacilitiesResult>("/api/notifications/reminders?" + params.toString()));
      setMessage("");
      focusFacilityList();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load facilities for this status.");
    } finally {
      setIsLoadingFacilities(false);
    }
  }

  async function loadReminderQueueFacilities() {
    setSelectedCard(null);
    setSelectedListMode("queue");
    setSelectedListTitle("Facility Reminder Queue");
    setStatusFacilities(null);
    setIsLoadingFacilities(true);
    setMessage("Loading facilities with reminders due today...");
    focusFacilityList();
    try {
      const params = new URLSearchParams({ dueOnly: "true", list: "facilities", owner: "facility", limit: "20000" });
      setStatusFacilities(await fetchJson<StatusFacilitiesResult>("/api/notifications/reminders?" + params.toString()));
      setMessage("");
      focusFacilityList();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load the facility reminder queue.");
    } finally {
      setIsLoadingFacilities(false);
    }
  }

  async function runReminderAutomation(confirmed: boolean) {
    if (confirmed) {
      const allowed = window.confirm("Send due reminders by bulk email and SMS to all eligible facilities in the reminder queue? Facilities without email or phone will remain for contact sourcing. Stale records older than 7 days will be verified from the live portal before any reminder is sent.");
      if (!allowed) return;
    }

    setIsRunningReminders(true);
    setReminderMessage("");
    setMessage("");

    try {
      const result = await fetchJson<ReminderSendResult>("/api/notifications/reminders", confirmed ? {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true, createdBy: "Admin User" }),
      } : undefined);
      setReminderMessage(confirmed
        ? sendSummaryText(result)
        : result.summary + " Preview recipients: " + (result.preview?.recipientCount ?? 0).toLocaleString() + ". Stale blocked: " + (result.preview?.staleCacheBlocked ?? 0).toLocaleString() + ".");
      await load();
      if (selectedListMode === "status" && selectedCard) await loadStatusFacilities(selectedCard);
      if (selectedListMode === "queue") await loadReminderQueueFacilities();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to run reminder automation.");
    } finally {
      setIsRunningReminders(false);
    }
  }

  async function resolveFailedLogs(channel: "all" | "email" | "sms") {
    const label = channel === "all" ? "all failed email and SMS logs" : channel + " failed logs";
    const allowed = window.confirm("Resolve " + label + "? This archives historical provider failures as resolved. It does not resend messages or delete audit history.");
    if (!allowed) return;

    setIsResolvingFailures(true);
    setMessage("");
    setReminderMessage("");

    try {
      const result = await fetchJson<ResolveFailedResult>("/api/notifications/resolve-failed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, createdBy: "Admin User" }),
      });
      setMessage("Resolved " + result.resolved.toLocaleString() + " historical failed notification log" + (result.resolved === 1 ? "" : "s") + ". Future sends will still depend on valid Gmail/Resend and Termii configuration.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to resolve failed logs.");
    } finally {
      setIsResolvingFailures(false);
    }
  }

  async function sourceMissingContacts(scope: "all" | "current") {
    const currentStatus = selectedListMode === "status" && selectedCard ? selectedCard.key : "";
    const dueOnly = selectedListMode === "queue";
    const label = scope === "current"
      ? dueOnly ? "the current due reminder queue" : currentStatus ? selectedListTitle : "the current list"
      : "all facility reminder records";
    const allowed = window.confirm("Source missing email and phone numbers for " + label + "? The agent will check the portal detail cache and update only confident exact facility matches.");
    if (!allowed) return;

    setIsSourcingContacts(true);
    setMessage("Sourcing missing contact details from the portal detail cache...");
    setReminderMessage("");

    try {
      const result = await fetchJson<ContactSourcingResult>("/api/notifications/source-contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scope === "current" ? {
          dueOnly,
          owner: dueOnly ? "facility" : "all",
          status: currentStatus,
          limit: 20000,
        } : { owner: "facility", limit: 20000 }),
      });
      setMessage("Contact sourcing completed. Checked " + result.missingTargets.toLocaleString() + " facilities with missing contacts. Updated " + result.updated.toLocaleString() + ". Email found: " + result.emailFound.toLocaleString() + ". Phone found: " + result.phoneFound.toLocaleString() + ". Not found: " + result.notFound.toLocaleString() + ". Ambiguous: " + result.ambiguous.toLocaleString() + ".");
      await load();
      if (selectedListMode === "status" && selectedCard) await loadStatusFacilities(selectedCard);
      if (selectedListMode === "queue") await loadReminderQueueFacilities();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to source missing contact details.");
    } finally {
      setIsSourcingContacts(false);
    }
  }

  async function sendStatusReminder(statusKey: string, recipientId?: string) {
    if (!recipientId) {
      const allowed = window.confirm("Send email and SMS reminders to all due facilities under this status? Facilities without available contact details will remain for contact sourcing.");
      if (!allowed) return;
      setSendingAllStatus(statusKey);
    } else {
      setSendingRecipientId(recipientId);
    }

    setMessage("");
    setReminderMessage("");

    try {
      const result = await fetchJson<ReminderSendResult>("/api/notifications/reminders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmed: true,
          createdBy: "Admin User",
          includeNotDue: true,
          selectedRecipientIds: recipientId ? [recipientId] : undefined,
          status: statusKey,
        }),
      });
      setReminderMessage(sendSummaryText(result));
      await load();
      if (selectedListMode === "status" && selectedCard) await loadStatusFacilities(selectedCard);
      if (selectedListMode === "queue") await loadReminderQueueFacilities();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to send reminder.");
    } finally {
      setSendingRecipientId(null);
      setSendingAllStatus(null);
    }
  }

  async function runPortalNotificationScan(mode: "quick" | "full") {
    setIsStartingPortalScan(mode);
    setMessage(mode === "quick"
      ? "Starting quick status scan. This refreshes portal status, category, and workflow counts."
      : "Starting full contact scan. This opens facility records and refreshes email, facility phone, address, and detailed fields.");
    try {
      await fetchJson<unknown>("/api/portal/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      setMessage(mode === "quick"
        ? "Quick status scan started in the background. Refresh this page after progress completes to see updated notification queues."
        : "Full contact scan started in the background. It will update phone and email data as facility details are captured.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start portal scan.");
    } finally {
      setIsStartingPortalScan(null);
    }
  }

  useEffect(() => { void load(); }, []);

  const intelligence = summary?.intelligence;
  const selectedRows = statusFacilities?.rows ?? [];

  return (
    <AppShell>
      <section className="min-h-screen bg-[#f6f9ff] px-4 py-6 xl:px-6 2xl:px-7">
        <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_22px_60px_rgba(15,23,42,0.07)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700"><Sparkles className="h-4 w-4" /> HEFA-AI Notification Centre</p>
              <h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-slate-950">Facility Email, SMS & Reminder Desk</h1>
              <p className="mt-1 max-w-3xl text-[14px] font-medium leading-6 text-slate-600">Detect facility reminders, separate HEFAMAA staff action, and block stale-cache reminders until live portal verification confirms the status.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="inline-flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-3 text-[12px] font-semibold text-white hover:bg-blue-700" href="/notifications/compose"><MailCheck className="h-4 w-4" /> Compose</Link>
              <Link className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[12px] font-semibold text-slate-700 hover:bg-blue-50" href="/notifications/history"><FileText className="h-4 w-4" /> History</Link>
              <Link className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-[12px] font-semibold text-slate-700 hover:bg-blue-50" href="/notifications/rules"><ShieldCheck className="h-4 w-4" /> Rules</Link>
              <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-[12px] font-semibold text-blue-700 disabled:opacity-60" disabled={isRunningReminders} onClick={() => void runReminderAutomation(false)} type="button">{isRunningReminders ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock3 className="h-4 w-4" />} Scan Queue</button>
              <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[12px] font-semibold text-indigo-700 disabled:opacity-60" disabled={isSourcingContacts} onClick={() => void sourceMissingContacts("all")} type="button">{isSourcingContacts ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />} Source Contacts</button>
              <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 text-[12px] font-semibold text-blue-700 disabled:opacity-60" disabled={Boolean(isStartingPortalScan)} onClick={() => void runPortalNotificationScan("quick")} type="button">{isStartingPortalScan === "quick" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Quick Status Scan</button>
              <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[12px] font-semibold text-emerald-700 disabled:opacity-60" disabled={Boolean(isStartingPortalScan)} onClick={() => void runPortalNotificationScan("full")} type="button">{isStartingPortalScan === "full" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />} Full Contact Scan</button>
              <button className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={isRunningReminders} onClick={() => void runReminderAutomation(true)} type="button"><Send className="h-4 w-4" /> Send Bulk Due</button>
              <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 text-[12px] font-semibold text-blue-700 disabled:opacity-60" disabled={isLoading} onClick={() => void load()} type="button">{isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />} Refresh</button>
            </div>
          </div>
          {message ? <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800">{message}</p> : null}
          {reminderMessage ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-700">{reminderMessage}</p> : null}
          <div className="mt-5 grid gap-4 md:grid-cols-5">
            <StatCard icon={MailCheck} label="Sent" value={summary?.totalSent ?? "-"} />
            <StatCard icon={RefreshCcw} label="Pending" value={summary?.totalPending ?? "-"} />
            <StatCard icon={XCircle} label="Failed Logs" value={summary?.totalFailed ?? "-"} />
            <StatCard icon={UsersRound} label="Need Attention" value={summary?.facilitiesRequiringAttention ?? "-"} />
            <StatCard icon={ShieldCheck} label="Active Rules" value={summary?.scheduler.activeRules ?? "-"} />
          </div>
        </div>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-slate-950">HEFAMAA Attention Panel</h2>
              <p className="mt-1 text-[13px] font-medium text-slate-500">View facilities by status, send a single reminder, or send all due reminders under one status.</p>
            </div>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">Updated {formatDate(intelligence?.generatedAt ?? null)}</span>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
            {(intelligence?.attentionCards ?? []).map((card) => <AttentionCardView card={card} isActive={selectedCard?.key === card.key} key={card.key} onView={(nextCard) => void loadStatusFacilities(nextCard)} />)}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <QueueMetric icon={Send} label="Reminder Queue" tone="amber" value={intelligence?.reminderQueueCount} />
            <QueueMetric icon={UserCheck} label="HEFAMAA Action" tone="blue" value={intelligence?.hefamaaAttentionCount} />
            <QueueMetric icon={AlertTriangle} label="Stale Cache Blocked" tone="rose" value={intelligence?.staleCacheBlockedCount} />
            <QueueMetric icon={Clock3} label="Background Verify" tone="emerald" value={intelligence?.backgroundVerificationCount} />
            <QueueMetric icon={ClipboardCheck} label="Renewal Overdue" tone="amber" value={intelligence?.renewalOverdueCount} />
          </div>
          {intelligence?.delivery ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <QueueMetric icon={MailCheck} label="Email Ready" tone="blue" value={intelligence.delivery.emailReadyCount} />
              <QueueMetric icon={Smartphone} label="SMS Ready" tone="emerald" value={intelligence.delivery.smsReadyCount} />
              <QueueMetric icon={MailWarning} label="Missing Email" tone="amber" value={intelligence.delivery.missingEmailCount} />
              <QueueMetric icon={PhoneOff} label="Missing Phone" tone="rose" value={intelligence.delivery.missingPhoneCount} />
            </div>
          ) : null}

          {selectedListMode ? (
            <div className="mt-5 scroll-mt-6 rounded-3xl border border-blue-100 bg-blue-50/40 p-4" ref={facilityListRef}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-[16px] font-semibold text-slate-950">{selectedListTitle || "Facilities"}</h3>
                  <p className="mt-1 text-[12px] font-medium text-slate-600">{isLoadingFacilities ? "Loading facilities..." : formatNumber(statusFacilities?.count) + " facilities found. " + formatNumber(statusFacilities?.delivery.recipientCount) + (selectedListMode === "queue" ? " are due for reminders today." : " can receive reminders where contact details exist.")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedListMode === "queue" ? (
                    <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={isLoadingFacilities || isRunningReminders || (statusFacilities?.delivery.recipientCount ?? 0) === 0} onClick={() => void runReminderAutomation(true)} type="button">
                      {isRunningReminders ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send All Due
                    </button>
                  ) : selectedCard ? (
                    <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60" disabled={isLoadingFacilities || sendingAllStatus === selectedCard.key || (statusFacilities?.delivery.recipientCount ?? 0) === 0} onClick={() => void sendStatusReminder(selectedCard.key)} type="button">
                      {sendingAllStatus === selectedCard.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send All Listed
                    </button>
                  ) : null}
                  <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3 text-[12px] font-semibold text-indigo-700 disabled:opacity-60" disabled={isSourcingContacts} onClick={() => void sourceMissingContacts("current")} type="button">{isSourcingContacts ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />} Source Missing Contacts</button>
                  <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-blue-200 bg-white px-3 text-[12px] font-semibold text-blue-700" onClick={() => selectedListMode === "queue" ? void loadReminderQueueFacilities() : selectedCard ? void loadStatusFacilities(selectedCard) : undefined} type="button"><RefreshCcw className="h-4 w-4" /> Reload List</button>
                </div>
              </div>
              {statusFacilities?.delivery ? (
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <QueueMetric icon={MailCheck} label="Status Email Ready" tone="blue" value={statusFacilities.delivery.emailReadyCount} />
                  <QueueMetric icon={Smartphone} label="Status SMS Ready" tone="emerald" value={statusFacilities.delivery.smsReadyCount} />
                  <QueueMetric icon={MailWarning} label="Missing Email" tone="amber" value={statusFacilities.delivery.missingEmailCount} />
                  <QueueMetric icon={PhoneOff} label="Missing Phone" tone="rose" value={statusFacilities.delivery.missingPhoneCount} />
                </div>
              ) : null}
              <div className="mt-4 max-h-[620px] overflow-auto rounded-2xl border border-slate-200 bg-white">
                {isLoadingFacilities ? (
                  <div className="flex min-h-[160px] items-center justify-center gap-2 text-[13px] font-semibold text-slate-600"><Loader2 className="h-4 w-4 animate-spin" /> Loading facilities</div>
                ) : selectedRows.length ? selectedRows.map((row, index) => {
                  const recipientId = rowText(row, "Recipient ID");
                  const canSend = rowText(row, "Next Action Owner") === "facility" && Boolean(recipientId);
                  return (
                    <article className="border-b border-slate-100 p-4 last:border-b-0" key={(recipientId || rowText(row, "Facility Name") || "status-row") + "-" + index}>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-semibold text-slate-950">{rowText(row, "Facility Name") || "Unknown facility"}</p>
                          <p className="mt-1 text-[12px] font-medium text-slate-500">{rowText(row, "Status") || "No status"} | {rowText(row, "Category") || "No category"}</p>
                          <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold">
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">HEF: {rowText(row, "HEF/NO / Portal ID") || "-"}</span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">LGA: {rowText(row, "LGA") || "-"}</span>
                            <span className={(rowBool(row, "Email Available") ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700") + " rounded-full px-2.5 py-1"}>{rowBool(row, "Email Available") ? "Email available" : "No email"}</span>
                            <span className={(rowBool(row, "Phone Available") ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700") + " rounded-full px-2.5 py-1"}>{rowBool(row, "Phone Available") ? "Phone available" : "No phone"}</span>
                            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">Owner: {rowText(row, "Next Action Owner") || "unknown"}</span>
                          </div>
                        </div>
                        <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-[12px] font-semibold text-white hover:bg-emerald-700 disabled:bg-slate-200 disabled:text-slate-500" disabled={!canSend || sendingRecipientId === recipientId} onClick={() => void sendStatusReminder(selectedListMode === "status" && selectedCard ? selectedCard.key : "", recipientId)} title={!canSend ? "HEFAMAA owns the next action for this facility, so no facility reminder should be sent." : "Send email and SMS reminder"} type="button">
                          {sendingRecipientId === recipientId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Reminder
                        </button>
                      </div>
                    </article>
                  );
                }) : <p className="p-4 text-[13px] font-medium text-slate-500">No facilities are available for this status.</p>}
              </div>
            </div>
          ) : null}
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <h2 className="text-[16px] font-semibold text-slate-950">Provider Status</h2>
            <div className="mt-4 grid gap-3">
              <div className="flex items-center justify-between rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3"><span className="text-[13px] font-semibold text-blue-800">Active Email Provider</span><span className="rounded-full bg-blue-600 px-3 py-1 text-[11px] font-semibold text-white">{summary?.availableProviders.activeEmailProvider === "gmail" || summary?.availableProviders.activeEmailProvider === "gmail-smtp" ? "Gmail SMTP" : "Auto"}</span></div>
              {[["Gmail SMTP", summary?.availableProviders.gmailSmtp], ["Resend Email", summary?.availableProviders.resend], ["Termii SMS", summary?.availableProviders.termii], ["Email Webhook", summary?.availableProviders.emailWebhook], ["SMS Webhook", summary?.availableProviders.smsWebhook]].map(([label, ready]) => <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3" key={String(label)}><span className="text-[13px] font-semibold text-slate-700">{label}</span><span className={(ready ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-amber-50 text-amber-700 ring-amber-100") + " rounded-full px-3 py-1 text-[11px] font-semibold ring-1"}>{ready ? "Configured" : "Pending setup"}</span></div>)}
            </div>
            <p className="mt-4 rounded-2xl bg-blue-50 p-4 text-[13px] font-medium leading-6 text-blue-800">Quick Status Scan refreshes facility status and category from the portal list. Full Contact Scan opens each facility record and updates email, address, and the facility page phone number used for SMS.</p>
            {(summary?.totalFailed ?? 0) > 0 ? (
              <div className="mt-3 rounded-2xl bg-amber-50 p-4 text-[13px] font-semibold leading-6 text-amber-800">
                <p>Active failed notifications: Email failed: {formatNumber(summary?.channelStatusCounts?.email?.failed ?? 0)}. SMS failed: {formatNumber(summary?.channelStatusCounts?.sms?.failed ?? 0)}.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button className="inline-flex h-9 items-center gap-2 rounded-xl bg-amber-600 px-3 text-[12px] font-semibold text-white hover:bg-amber-700 disabled:opacity-60" disabled={isResolvingFailures || !summary?.totalFailed} onClick={() => void resolveFailedLogs("all")} type="button">
                    {isResolvingFailures ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} Resolve All Failed
                  </button>
                  <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 text-[12px] font-semibold text-amber-800 disabled:opacity-60" disabled={isResolvingFailures || !summary?.channelStatusCounts?.email?.failed} onClick={() => void resolveFailedLogs("email")} type="button">Resolve Email</button>
                  <button className="inline-flex h-9 items-center gap-2 rounded-xl border border-amber-200 bg-white px-3 text-[12px] font-semibold text-amber-800 disabled:opacity-60" disabled={isResolvingFailures || !summary?.channelStatusCounts?.sms?.failed} onClick={() => void resolveFailedLogs("sms")} type="button">Resolve SMS</button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="text-[16px] font-semibold text-slate-950">Facility Reminder Queue</h2><div className="flex items-center gap-2"><span className="rounded-full bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-100">{formatNumber(intelligence?.reminderQueueCount)}</span><button className="inline-flex h-8 items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 text-[11px] font-semibold text-amber-700 hover:bg-amber-100" onClick={() => void loadReminderQueueFacilities()} type="button"><Eye className="h-3.5 w-3.5" /> View Queue</button></div></div>
                <MiniTable emptyText="No facility reminders are due from the current cache." rows={intelligence?.reminderQueue ?? []} />
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-[16px] font-semibold text-slate-950">HEFAMAA Staff Action</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">{formatNumber(intelligence?.hefamaaAttentionCount)}</span></div>
                <MiniTable emptyText="No internal HEFAMAA attention flags are pending." rows={intelligence?.hefamaaAttention ?? []} />
              </div>
            </div>
          </section>
        </div>

        <section className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
          <div className="flex items-center justify-between gap-3"><h2 className="text-[16px] font-semibold text-slate-950">Recent Notification History</h2><span className="rounded-full bg-blue-50 px-3 py-1 text-[11px] font-semibold text-blue-700 ring-1 ring-blue-100">{summary?.outboxCount ?? 0} total</span></div>
          <div className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200">
            {summary?.recentMessages.length ? summary.recentMessages.map((item, index) => <article className="p-4" key={item.id + "-" + index}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-[14px] font-semibold text-slate-950">{item.facility_name}</p><p className="mt-1 text-[12px] font-medium text-slate-500">{item.subject}</p></div><span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold capitalize text-slate-600">{item.status}</span></div><div className="mt-3 flex flex-wrap gap-2 text-[11px] font-semibold"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{item.channel.toUpperCase()}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{formatDate(item.sent_at || item.created_at)}</span><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{item.notification_type}</span></div></article>) : <p className="p-4 text-[13px] font-medium text-slate-500">No notification logs have been created yet.</p>}
          </div>
        </section>
      </section>
    </AppShell>
  );
}
