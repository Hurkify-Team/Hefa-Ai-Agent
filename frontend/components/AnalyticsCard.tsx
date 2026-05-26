"use client";

import { useEffect, useState } from "react";
import { Activity, Bot, Building2, Database, Sparkles } from "lucide-react";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type WorkbookReportSummary = {
  totalFacilities: number;
  totalCategories: number;
  incompleteRecords: number;
};

async function fetchApi<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function formatNumber(value: number | null) {
  return value == null ? "-" : new Intl.NumberFormat("en-US").format(value);
}

export function AnalyticsCard() {
  const [summary, setSummary] = useState<WorkbookReportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    fetchApi<WorkbookReportSummary>("/api/reports/summary")
      .then((data) => {
        if (mounted) setSummary(data);
      })
      .catch((error) => {
        if (mounted) setError(error instanceof Error ? error.message : "Unable to load analytics");
      });

    return () => {
      mounted = false;
    };
  }, []);

  const rows = [
    { label: "Total Facilities", value: formatNumber(summary?.totalFacilities ?? null), icon: Building2, className: "bg-blue-50 text-blue-700" },
    { label: "Active Facilities", value: summary ? formatNumber(summary.totalFacilities - summary.incompleteRecords) : "-", icon: Activity, className: "bg-emerald-50 text-emerald-700" },
    { label: "Incomplete Records", value: formatNumber(summary?.incompleteRecords ?? null), icon: Bot, className: "bg-amber-50 text-amber-700" },
    { label: "Total Categories", value: formatNumber(summary?.totalCategories ?? null), icon: Database, className: "bg-violet-50 text-violet-700" },
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-[16px] font-bold text-slate-950">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          Quick Analytics
        </h2>
        <p className="mt-1 text-[12px] text-slate-500">{error ?? "Live Google Sheet summary"}</p>
      </div>
      <div className="space-y-3">
        {rows.map((row) => {
          const Icon = row.icon;

          return (
            <div className={"flex items-center gap-3 rounded-lg px-3 py-3 " + row.className} key={row.label}>
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/70">
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="text-[11px] font-medium opacity-80">{row.label}</p>
                <p className="text-[18px] font-extrabold leading-5">{row.value}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
