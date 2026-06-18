"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Database,
  FileWarning,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type WorkbookReportSummary = {
  totalFacilities: number;
  totalCategories: number;
  incompleteRecords: number;
  categorySummary: Array<{
    category: string;
    rows: number;
    headers: number;
  }>;
  missingDataSummary: Array<{
    category: string;
    missingRecords: number;
  }>;
  duplicateSummary: {
    exactDuplicateKeys: number;
    possibleDuplicateKeys: number;
  };
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-NG").format(value);
}

export default function BulkOperationsPage() {
  const [summary, setSummary] = useState<WorkbookReportSummary | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshingCache, setIsRefreshingCache] = useState(false);

  useEffect(() => {
    void loadSummary();
  }, []);

  async function loadSummary() {
    setIsLoading(true);
    setError(null);

    try {
      setSummary(await fetchApi<WorkbookReportSummary>("/api/reports/summary"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load workbook summary");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshWorkbookCache() {
    setIsRefreshingCache(true);
    setCacheMessage(null);
    setError(null);

    try {
      const result = await fetchApi<{ clearedAt: string }>("/api/sheets/cache", {
        method: "POST",
      });
      setCacheMessage(`Workbook cache cleared at ${new Date(result.clearedAt).toLocaleTimeString()}.`);
      await loadSummary();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to refresh workbook data");
    } finally {
      setIsRefreshingCache(false);
    }
  }

  const cards = useMemo(
    () => [
      {
        label: "Facilities Reviewed",
        value: summary ? formatNumber(summary.totalFacilities) : "-",
        icon: Database,
        className: "bg-blue-50 text-blue-700",
      },
      {
        label: "Categories",
        value: summary ? formatNumber(summary.totalCategories) : "-",
        icon: BarChart3,
        className: "bg-blue-50 text-blue-700",
      },
      {
        label: "Incomplete Records",
        value: summary ? formatNumber(summary.incompleteRecords) : "-",
        icon: FileWarning,
        className: "bg-amber-50 text-amber-700",
      },
      {
        label: "Duplicate Keys",
        value: summary ? formatNumber(summary.duplicateSummary.exactDuplicateKeys) : "-",
        icon: ShieldAlert,
        className: "bg-rose-50 text-rose-700",
      },
    ],
    [summary],
  );

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              Bulk Operations
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Workbook-wide review tools for cache refresh, data quality, duplicate risk, and category coverage
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:text-slate-400"
              disabled={isLoading}
              onClick={() => void loadSummary()}
              type="button"
            >
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh Summary
            </button>
            <button
              className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isRefreshingCache}
              onClick={() => void refreshWorkbookCache()}
              type="button"
            >
              {isRefreshingCache ? <Loader2 className="h-4 w-4 animate-spin" /> : <Database className="h-4 w-4" />}
              Refresh Workbook Data
            </button>
          </div>
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        {cacheMessage ? (
          <p className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800">
            <CheckCircle2 className="h-4 w-4" />
            {cacheMessage}
          </p>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-4">
          {cards.map(({ icon: Icon, ...card }) => (
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={card.label}>
              <span className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${card.className}`}>
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.03em] text-slate-500">{card.label}</h2>
              <p className="mt-2 text-[26px] font-extrabold tracking-[-0.02em] text-slate-950">{card.value}</p>
            </article>
          ))}
        </div>

        <div className="grid gap-5 2xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-600" />
              <h2 className="text-[17px] font-bold text-slate-950">Category Coverage</h2>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[1fr_110px_110px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                <span>Category</span>
                <span>Rows</span>
                <span>Headers</span>
              </div>
              {(summary?.categorySummary ?? []).map((item) => (
                <div className="grid grid-cols-[1fr_110px_110px] border-t border-slate-200 px-4 py-3 text-[12px]" key={item.category}>
                  <span className="truncate font-bold text-slate-950">{item.category}</span>
                  <span className="font-semibold text-slate-700">{formatNumber(item.rows)}</span>
                  <span className="font-semibold text-slate-700">{formatNumber(item.headers)}</span>
                </div>
              ))}
              {!summary && isLoading ? (
                <p className="border-t border-slate-200 p-4 text-[13px] font-semibold text-slate-500">
                  Loading workbook summary...
                </p>
              ) : null}
            </div>
          </section>

          <section className="space-y-5">
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-amber-600" />
                <h2 className="text-[17px] font-bold text-slate-950">Highest Missing Data</h2>
              </div>
              <div className="space-y-3">
                {(summary?.missingDataSummary ?? []).slice(0, 8).map((item) => (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={item.category}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-[13px] font-bold text-slate-950">{item.category}</p>
                      <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                        {formatNumber(item.missingRecords)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-rose-600" />
                <h2 className="text-[17px] font-bold text-slate-950">Bulk Safety</h2>
              </div>
              <div className="space-y-3 text-[13px] font-semibold leading-5 text-slate-600">
                <p className="rounded-lg bg-slate-50 p-3">No bulk write operation runs without a preview and explicit confirmation.</p>
                <p className="rounded-lg bg-slate-50 p-3">Workbook refresh clears local cache only. It does not modify Google Drive data.</p>
                <p className="rounded-lg bg-slate-50 p-3">Duplicate and missing-data actions are review-first in this MVP.</p>
              </div>
            </article>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
