"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import type { AuditActionType, AuditEntry } from "@/types/audit";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type StatusFilter = "all" | AuditEntry["status"];
type ActionFilter = "all" | AuditActionType;

const actionLabels: Record<AuditActionType, string> = {
  add: "Add",
  update: "Update",
  category_created: "Category Created",
  analysis: "Analysis",
  capture: "Capture",
  duplicate_check: "Duplicate Check",
  cleaning: "Data Cleaning",
};

async function fetchApi<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function statusClasses(status: AuditEntry["status"]) {
  if (status === "success") {
    return "bg-blue-100 text-blue-800";
  }

  if (status === "warning") {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-rose-100 text-rose-800";
}

function StatusBadge({ status }: { status: AuditEntry["status"] }) {
  const Icon = status === "success" ? CheckCircle2 : status === "warning" ? ShieldAlert : XCircle;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(status)}`}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function entrySearchText(entry: AuditEntry) {
  return [
    entry.timestamp,
    entry.user,
    entry.actionType,
    entry.category,
    entry.facilityName,
    entry.affectedRow,
    entry.status,
    entry.details,
    entry.sourcePortalUrl,
    ...(entry.missingFields ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [actionFilter, setActionFilter] = useState<ActionFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void loadAuditLog();
  }, []);

  async function loadAuditLog() {
    setIsLoading(true);
    setError(null);

    try {
      setEntries(await fetchApi<AuditEntry[]>("/api/audit/list?limit=250"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load audit log");
    } finally {
      setIsLoading(false);
    }
  }

  function entryKey(entry: AuditEntry, index: number) {
    return String(entry.id ?? `${entry.timestamp}-${entry.actionType}-${index}`);
  }

  function toggleEntry(key: string) {
    setExpandedIds((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }

      return next;
    });
  }

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return entries.filter((entry) => {
      if (statusFilter !== "all" && entry.status !== statusFilter) {
        return false;
      }

      if (actionFilter !== "all" && entry.actionType !== actionFilter) {
        return false;
      }

      if (normalizedQuery && !entrySearchText(entry).includes(normalizedQuery)) {
        return false;
      }

      return true;
    });
  }, [actionFilter, entries, query, statusFilter]);

  const summary = useMemo(
    () => ({
      total: entries.length,
      success: entries.filter((entry) => entry.status === "success").length,
      warning: entries.filter((entry) => entry.status === "warning").length,
      failed: entries.filter((entry) => entry.status === "failed").length,
    }),
    [entries],
  );
  const summaryCards: Array<{
    label: string;
    value: number;
    icon: LucideIcon;
    className: string;
  }> = [
    { label: "Total Entries", value: summary.total, icon: ClipboardList, className: "bg-blue-50 text-blue-700" },
    { label: "Successful", value: summary.success, icon: CheckCircle2, className: "bg-blue-50 text-blue-700" },
    { label: "Warnings", value: summary.warning, icon: ShieldAlert, className: "bg-amber-50 text-amber-700" },
    { label: "Failed", value: summary.failed, icon: XCircle, className: "bg-rose-50 text-rose-700" },
  ];

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              Audit Log
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Trace captures, duplicate checks, saves, updates, categories, and database analysis
            </p>
          </div>
          <button
            className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={isLoading}
            onClick={() => void loadAuditLog()}
            type="button"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-4">
          {summaryCards.map(({ icon: Icon, ...card }) => (
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={card.label}>
              <span className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${card.className}`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="text-[12px] font-bold uppercase tracking-[0.03em] text-slate-500">{card.label}</p>
              <p className="mt-2 text-[24px] font-extrabold text-slate-950">{card.value}</p>
            </article>
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[1fr_180px_210px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-[13px] font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by facility, category, user, action, detail, or URL"
                value={query}
              />
            </div>
            <select
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
              value={statusFilter}
            >
              <option value="all">All statuses</option>
              <option value="success">Success</option>
              <option value="warning">Warning</option>
              <option value="failed">Failed</option>
            </select>
            <select
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              onChange={(event) => setActionFilter(event.target.value as ActionFilter)}
              value={actionFilter}
            >
              <option value="all">All actions</option>
              {Object.entries(actionLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
            <div className="grid grid-cols-[34px_160px_160px_140px_1fr_110px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
              <span />
              <span>Time</span>
              <span>Action</span>
              <span>Category</span>
              <span>Facility / Details</span>
              <span>Status</span>
            </div>

            {filteredEntries.map((entry, index) => {
              const key = entryKey(entry, index);
              const isExpanded = expandedIds.has(key);

              return (
                <article className="border-t border-slate-200" key={key}>
                  <button
                    className="grid w-full grid-cols-[34px_160px_160px_140px_1fr_110px] px-4 py-3 text-left text-[12px] text-slate-700 hover:bg-slate-50"
                    onClick={() => toggleEntry(key)}
                    type="button"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </span>
                    <span className="truncate font-semibold text-slate-700">{formatTimestamp(entry.timestamp)}</span>
                    <span className="truncate font-bold text-slate-950">{actionLabels[entry.actionType]}</span>
                    <span className="truncate font-semibold text-slate-700">{entry.category ?? "-"}</span>
                    <span className="truncate font-semibold text-slate-900">
                      {entry.facilityName || entry.details || entry.sourcePortalUrl || "-"}
                    </span>
                    <StatusBadge status={entry.status} />
                  </button>

                  {isExpanded ? (
                    <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4">
                      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                        {[
                          ["User", entry.user],
                          ["Action Type", entry.actionType],
                          ["Category", entry.category],
                          ["Facility", entry.facilityName],
                          ["Affected Row", entry.affectedRow != null ? String(entry.affectedRow + 2) : undefined],
                          [
                            "Confidence",
                            entry.confidenceScore != null ? `${Math.round(entry.confidenceScore * 100)}%` : undefined,
                          ],
                          ["Missing Fields", entry.missingFields?.length ? entry.missingFields.join(", ") : undefined],
                          ["Portal URL", entry.sourcePortalUrl],
                          ["Details", entry.details],
                        ].map(([label, value]) => (
                          <div className="rounded-lg border border-slate-200 bg-white p-3" key={label}>
                            <p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                              {label}
                            </p>
                            <p className="mt-1 break-words text-[13px] font-semibold leading-5 text-slate-900">
                              {value || "-"}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}

            {!filteredEntries.length ? (
              <div className="flex min-h-[180px] items-center justify-center border-t border-slate-200 bg-slate-50 p-6 text-center">
                <div>
                  <FileText className="mx-auto h-8 w-8 text-slate-400" />
                  <p className="mt-3 text-[13px] font-bold text-slate-800">
                    {isLoading ? "Loading audit entries" : "No audit entries match this view"}
                  </p>
                  <p className="mt-1 text-[12px] text-slate-500">
                    {isLoading ? "Reading local SQLite audit log." : "Try clearing search or filters."}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </section>
    </AppShell>
  );
}
