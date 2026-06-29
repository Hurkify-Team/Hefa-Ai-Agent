"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, BarChart3, FileWarning, Loader2, MapPin, Rows3 } from "lucide-react";

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
  lgaSummary: Array<{
    lga: string;
    count: number;
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

async function fetchApi<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "app/reports/page.tsx"));

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-NG").format(value);
}

export default function ReportsPage() {
  const [summary, setSummary] = useState<WorkbookReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadSummary() {
      setIsLoading(true);
      setError(null);

      try {
        setSummary(await fetchApi<WorkbookReportSummary>("/api/reports/summary"));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to load reports");
      } finally {
        setIsLoading(false);
      }
    }

    loadSummary();
  }, []);

  const reportCards = useMemo(
    () => [
      {
        title: "Total Facilities",
        value: summary ? formatNumber(summary.totalFacilities) : "-",
        icon: Rows3,
        className: "bg-blue-50 text-blue-700",
      },
      {
        title: "Total Categories",
        value: summary ? formatNumber(summary.totalCategories) : "-",
        icon: BarChart3,
        className: "bg-blue-50 text-blue-700",
      },
      {
        title: "Incomplete Records",
        value: summary ? formatNumber(summary.incompleteRecords) : "-",
        icon: FileWarning,
        className: "bg-amber-50 text-amber-700",
      },
      {
        title: "Duplicate Keys",
        value: summary ? formatNumber(summary.duplicateSummary.exactDuplicateKeys) : "-",
        icon: AlertTriangle,
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
              Reports & Analytics
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Category, LGA, missing data, and duplicate summaries
            </p>
          </div>
          {isLoading ? (
            <span className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] font-bold text-slate-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading workbook
            </span>
          ) : null}
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-4">
          {reportCards.map(({ icon: Icon, ...card }) => (
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={card.title}>
              <span className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${card.className}`}>
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.03em] text-slate-500">
                {card.title}
              </h2>
              <p className="mt-2 text-[26px] font-extrabold tracking-[-0.02em] text-slate-950">
                {card.value}
              </p>
            </article>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Rows3 className="h-5 w-5 text-blue-600" />
              <h2 className="text-[17px] font-bold text-slate-950">Category Summary</h2>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[1fr_100px_100px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                <span>Category</span>
                <span>Rows</span>
                <span>Headers</span>
              </div>
              {(summary?.categorySummary ?? []).slice(0, 12).map((item) => (
                <div
                  className="grid grid-cols-[1fr_100px_100px] border-t border-slate-200 px-4 py-3 text-[12px]"
                  key={item.category}
                >
                  <span className="truncate font-bold text-slate-950">{item.category}</span>
                  <span className="font-semibold text-slate-700">{formatNumber(item.rows)}</span>
                  <span className="font-semibold text-slate-700">{formatNumber(item.headers)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <MapPin className="h-5 w-5 text-blue-700" />
              <h2 className="text-[17px] font-bold text-slate-950">Top LGAs</h2>
            </div>
            <div className="space-y-3">
              {(summary?.lgaSummary ?? []).slice(0, 10).map((item) => (
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2" key={item.lga}>
                  <span className="truncate text-[12px] font-bold text-slate-800">{item.lga || "Unknown"}</span>
                  <span className="text-[12px] font-extrabold text-slate-950">{formatNumber(item.count)}</span>
                </div>
              ))}
              {!summary?.lgaSummary.length && !isLoading ? (
                <p className="rounded-lg bg-slate-50 p-4 text-[13px] font-semibold text-slate-500">
                  No LGA data found.
                </p>
              ) : null}
            </div>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <FileWarning className="h-5 w-5 text-amber-600" />
            <h2 className="text-[17px] font-bold text-slate-950">Missing Data Summary</h2>
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            {(summary?.missingDataSummary ?? []).slice(0, 9).map((item) => (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={item.category}>
                <p className="truncate text-[13px] font-bold text-slate-950">{item.category}</p>
                <p className="mt-2 text-[22px] font-extrabold text-amber-700">
                  {formatNumber(item.missingRecords)}
                </p>
                <p className="text-[12px] font-semibold text-slate-500">records missing key fields</p>
              </div>
            ))}
          </div>
        </section>
      </section>
    </AppShell>
  );
}
