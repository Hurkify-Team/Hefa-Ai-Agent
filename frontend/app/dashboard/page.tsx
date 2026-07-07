"use client";

import { safeFetchJson } from "@/lib/safeFetchJson";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  BellRing,
  ClipboardList,
  Database,
  FileWarning,
  FolderKanban,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Rows3,
  Search,
  ShieldCheck,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import type { DatabaseQuestionResult } from "@/types/ai";
import type { AuditEntry } from "@/types/audit";
import type { SheetRow, SheetTab } from "@/types/sheet";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type PortalAnalytics = {
  totalScanned: number;
  lastScanDate: string | null;
  verifiedLive: number;
  staleCache: number;
  statusCounts: {
    DOCUMENT_QUERY?: number;
    DOCUMENT_QUERIED: number;
    UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: number;
    PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: number;
    DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING: number;
    INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING: number;
    FINAL_APPROVAL_PENDING: number;
    REGISTRATION_APPROVED: number;
  };
  sectorCounts?: {
    PUBLIC: number;
    PRIVATE: number;
    UNKNOWN: number;
  };
  actionCounts: {
    facilityReminderRequired: number;
    hefamaaAttentionRequired: number;
  };
  cacheEmpty?: boolean;
};

type RegistrationApprovedFacilityRow = {
  id: string;
  facilityName: string | null;
  facilityCode: string | null;
  category: string | null;
  lga: string | null;
  approvalDate: string | null;
  approvalMonth: string | null;
  approvalYear: string | null;
  approvalDateSource: string | null;
  approvalDateWarning: string | null;
  portalStatus: string;
  lastScanDate: string | null;
};

type RegistrationApprovedAnalytics = {
  totalApproved: number;
  approvedThisMonth: number;
  approvedLastMonth: number;
  approvedThisYear: number;
  approvedLastYear: number;
  approvedWithoutDate: number;
  monthly: Array<{ month: string; count: number }>;
  yearly: Array<{ year: string; count: number }>;
  facilities: RegistrationApprovedFacilityRow[];
  source: "portal_cache";
  lastScan: string | null;
};

type WorkbookReportSummary = {
  dataSourceLabel?: string;
  fileName?: string;
  mimeType?: string;
  readOnly?: boolean;
  sourceMode?: "google_sheet" | "excel_xlsx";
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

async function fetchApi<T>(url: string, init?: RequestInit) {
  const result = await safeFetchJson<ApiResult<T>>(url, init);

  if (!result.ok) {
    throw new Error(result.status === 502 ? "Service temporarily unavailable" : result.error);
  }

  const payload = result.data;
  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-NG").format(value);
}

function displayValue(value: SheetRow[string]) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "-";
  }

  return String(value);
}

function rowLabel(row: SheetRow) {
  const candidates = [row["Facility Name"], row["FACILITY NAME"], row.Name, row["HEF/NO"]];
  const match = candidates.find((value) => value !== null && value !== undefined && String(value).trim());

  return match ? String(match) : "Facility record";
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<WorkbookReportSummary | null>(null);
  const [portalAnalytics, setPortalAnalytics] = useState<PortalAnalytics | null>(null);
  const [registrationApprovedAnalytics, setRegistrationApprovedAnalytics] = useState<RegistrationApprovedAnalytics | null>(null);
  const [approvalDrilldown, setApprovalDrilldown] = useState<RegistrationApprovedAnalytics | null>(null);
  const [approvalDrilldownTitle, setApprovalDrilldownTitle] = useState("");
  const [isApprovalDrilldownLoading, setIsApprovalDrilldownLoading] = useState(false);
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [questionCategory, setQuestionCategory] = useState("");
  const [questionResult, setQuestionResult] = useState<DatabaseQuestionResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAsking, setIsAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questionError, setQuestionError] = useState<string | null>(null);

  useEffect(() => {
    void loadDashboard();
  }, []);

  async function loadDashboard() {
    setIsLoading(true);
    setError(null);

    const [summaryResult, tabsResult, auditResult, portalAnalyticsResult, registrationApprovedResult] = await Promise.allSettled([
      fetchApi<WorkbookReportSummary>("/api/reports/summary"),
      fetchApi<SheetTab[]>("/api/sheets/tabs"),
      fetchApi<AuditEntry[]>("/api/audit/list?limit=5"),
      fetchApi<PortalAnalytics>("/api/portal/analytics"),
      fetchApi<RegistrationApprovedAnalytics>("/api/portal/registration-approved-analytics"),
    ]);

    const warnings: string[] = [];

    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value);
    } else {
      setSummary(null);
      warnings.push("Reports summary unavailable: " + (summaryResult.reason instanceof Error ? summaryResult.reason.message : "Unknown error"));
    }

    if (tabsResult.status === "fulfilled") {
      setTabs(tabsResult.value);
    } else {
      setTabs([]);
      warnings.push("Sheet tabs unavailable: " + (tabsResult.reason instanceof Error ? tabsResult.reason.message : "Unknown error"));
    }

    if (auditResult.status === "fulfilled") {
      setAuditEntries(auditResult.value);
    } else {
      setAuditEntries([]);
      warnings.push("Audit log unavailable: " + (auditResult.reason instanceof Error ? auditResult.reason.message : "Unknown error"));
    }

    if (portalAnalyticsResult.status === "fulfilled") {
      setPortalAnalytics(portalAnalyticsResult.value);
    } else {
      setPortalAnalytics(null);
      warnings.push("Portal scan analytics unavailable: " + (portalAnalyticsResult.reason instanceof Error ? portalAnalyticsResult.reason.message : "Unknown error"));
    }

    if (registrationApprovedResult.status === "fulfilled") {
      setRegistrationApprovedAnalytics(registrationApprovedResult.value);
    } else {
      setRegistrationApprovedAnalytics(null);
      warnings.push("Registration approved analytics unavailable: " + (registrationApprovedResult.reason instanceof Error ? registrationApprovedResult.reason.message : "Unknown error"));
    }

    setError(warnings.length ? warnings.join(" ") : null);
    setIsLoading(false);
  }

  async function loadApprovalDrilldown(title: string, params: Record<string, string>) {
    setIsApprovalDrilldownLoading(true);
    setApprovalDrilldownTitle(title);
    try {
      const query = new URLSearchParams(params).toString();
      setApprovalDrilldown(await fetchApi<RegistrationApprovedAnalytics>("/api/portal/registration-approved-analytics?" + query));
    } catch (error) {
      setApprovalDrilldown({
        approvedLastMonth: 0,
        approvedLastYear: 0,
        approvedThisMonth: 0,
        approvedThisYear: 0,
        approvedWithoutDate: 0,
        facilities: [],
        lastScan: null,
        monthly: [],
        source: "portal_cache",
        totalApproved: 0,
        yearly: [],
      });
      setApprovalDrilldownTitle(error instanceof Error ? error.message : "Unable to load registration approved drill-down");
    } finally {
      setIsApprovalDrilldownLoading(false);
    }
  }

  async function askQuestion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!question.trim()) {
      return;
    }

    setIsAsking(true);
    setQuestionError(null);

    try {
      const result = await fetchApi<DatabaseQuestionResult>("/api/ai/ask-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          category: questionCategory || undefined,
        }),
      });

      setQuestionResult(result);
      setAuditEntries(await fetchApi<AuditEntry[]>("/api/audit/list?limit=5"));
    } catch (error) {
      setQuestionError(error instanceof Error ? error.message : "Unable to answer database question");
    } finally {
      setIsAsking(false);
    }
  }

  const cards = useMemo(
    () => [
      {
        label: "Total Facilities",
        value: summary ? formatNumber(summary.totalFacilities) : "-",
        icon: Rows3,
        className: "bg-blue-50 text-blue-700",
      },
      {
        label: "Total Categories",
        value: summary ? formatNumber(summary.totalCategories) : "-",
        icon: FolderKanban,
        className: "bg-blue-50 text-blue-700",
      },
      {
        label: "Incomplete Records",
        value: summary ? formatNumber(summary.incompleteRecords) : "-",
        icon: FileWarning,
        className: "bg-amber-50 text-amber-700",
      },
      {
        label: "Possible Duplicates",
        value: summary ? formatNumber(summary.duplicateSummary.possibleDuplicateKeys) : "-",
        icon: AlertTriangle,
        className: "bg-rose-50 text-rose-700",
      },
    ],
    [summary],
  );

  const portalCards = useMemo(
    () => [
      { label: "Total Portal Records Scanned", value: portalAnalytics ? formatNumber(portalAnalytics.totalScanned) : "-", tone: "bg-blue-50 text-blue-700" },
      { label: "Records Verified Live", value: portalAnalytics ? formatNumber(portalAnalytics.verifiedLive) : "-", tone: "bg-emerald-50 text-emerald-700" },
      { label: "Stale Cache Records", value: portalAnalytics ? formatNumber(portalAnalytics.staleCache) : "-", tone: "bg-amber-50 text-amber-700" },
      { label: "Public Sector Facilities", value: portalAnalytics ? formatNumber(portalAnalytics.sectorCounts?.PUBLIC ?? 0) : "-", tone: "bg-sky-50 text-sky-700" },
      { label: "Private Sector Facilities", value: portalAnalytics ? formatNumber(portalAnalytics.sectorCounts?.PRIVATE ?? 0) : "-", tone: "bg-emerald-50 text-emerald-700" },
      { label: "Document Query", value: portalAnalytics ? formatNumber(portalAnalytics.statusCounts.DOCUMENT_QUERY ?? portalAnalytics.statusCounts.DOCUMENT_QUERIED) : "-", tone: "bg-rose-50 text-rose-700" },
      { label: "Upload Payment Pending", value: portalAnalytics ? formatNumber(portalAnalytics.statusCounts.UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING) : "-", tone: "bg-orange-50 text-orange-700" },
      { label: "Payment Approved Pending", value: portalAnalytics ? formatNumber(portalAnalytics.statusCounts.PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING) : "-", tone: "bg-indigo-50 text-indigo-700" },
      { label: "Document Approved Inspection", value: portalAnalytics ? formatNumber(portalAnalytics.statusCounts.DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING) : "-", tone: "bg-blue-50 text-blue-700" },
      { label: "Inspection Approval Pending", value: portalAnalytics ? formatNumber(portalAnalytics.statusCounts.INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING) : "-", tone: "bg-amber-50 text-amber-700" },
      { label: "Final Approval Pending", value: portalAnalytics ? formatNumber(portalAnalytics.statusCounts.FINAL_APPROVAL_PENDING) : "-", tone: "bg-violet-50 text-violet-700" },
      { label: "Registration Approved", value: portalAnalytics ? formatNumber(portalAnalytics.statusCounts.REGISTRATION_APPROVED) : "-", tone: "bg-green-50 text-green-700" },
      { label: "HEFAMAA Action", value: portalAnalytics ? formatNumber(portalAnalytics.actionCounts.hefamaaAttentionRequired) : "-", tone: "bg-slate-100 text-slate-800" },
      { label: "Facility Reminder", value: portalAnalytics ? formatNumber(portalAnalytics.actionCounts.facilityReminderRequired) : "-", tone: "bg-cyan-50 text-cyan-700" },
    ],
    [portalAnalytics],
  );

  const topCategories = summary?.categorySummary.slice(0, 6) ?? [];
  const topLgas = summary?.lgaSummary.slice(0, 6) ?? [];
  const approvalMonthlyTrend = registrationApprovedAnalytics?.monthly.slice(-12) ?? [];
  const approvalYearlyTrend = registrationApprovedAnalytics?.yearly.slice(-6) ?? [];
  const maxApprovalMonth = Math.max(1, ...approvalMonthlyTrend.map((item) => item.count));
  const maxApprovalYear = Math.max(1, ...approvalYearlyTrend.map((item) => item.count));
  const matchedRows = questionResult?.rows?.slice(0, 5) ?? [];

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              Dashboard
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Live HEFAMAA workbook overview and database assistant
            </p>
            {summary?.sourceMode ? (
              <span className="mt-3 inline-flex items-center rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-blue-700">
                Data Source: {summary.dataSourceLabel ?? (summary.sourceMode === "excel_xlsx" ? "Excel File Mode" : "Google Sheet Mode")}{summary.readOnly ? " - Read Only" : ""}
              </span>
            ) : null}
          </div>
          <button
            className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={isLoading}
            onClick={() => void loadDashboard()}
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
          {cards.map(({ icon: Icon, ...card }) => (
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={card.label}>
              <span className={`mb-5 flex h-11 w-11 items-center justify-center rounded-xl ${card.className}`}>
                <Icon className="h-5 w-5" />
              </span>
              <p className="text-[12px] font-semibold text-slate-500">{card.label}</p>
              <p className="mt-1 text-[24px] font-extrabold text-slate-950">{card.value}</p>
            </article>
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BellRing className="h-5 w-5 text-blue-600" />
              <div>
                <h2 className="text-[17px] font-bold text-slate-950">Portal Scan Intelligence</h2>
                <p className="mt-1 text-[12px] font-semibold text-slate-500">Live portal-cache analytics, workflow status counts, and reminder intelligence</p>
              </div>
            </div>
            <span className="rounded-full bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
              Last scan: {portalAnalytics?.lastScanDate ? new Date(portalAnalytics.lastScanDate).toLocaleString("en-NG") : "Not available"}
            </span>
          </div>

          {portalAnalytics && !portalAnalytics.cacheEmpty ? (
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
              {portalCards.map((card) => (
                <article className="rounded-lg border border-slate-100 bg-slate-50/70 p-4" key={card.label}>
                  <span className={`mb-3 inline-flex rounded-lg px-2.5 py-1 text-[11px] font-extrabold ${card.tone}`}>{card.label}</span>
                  <p className="text-[22px] font-extrabold text-slate-950">{card.value}</p>
                </article>
              ))}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-[13px] font-semibold text-slate-500">
              No portal scan data yet. Run a portal scan to activate portal analytics.
            </p>
          )}
        </section>


        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              <div>
                <h2 className="text-[17px] font-bold text-slate-950">Registration Approved Analytics</h2>
                <p className="mt-1 text-[12px] font-semibold text-slate-500">Monthly and yearly approval trends from portal scan cache only</p>
              </div>
            </div>
            <span className="rounded-full bg-green-50 px-3 py-1 text-[11px] font-bold text-green-700 ring-1 ring-green-100">
              Source: Portal Cache
            </span>
          </div>

          {registrationApprovedAnalytics ? (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                {[
                  ["Total Registration Approved", registrationApprovedAnalytics.totalApproved, "bg-green-50 text-green-700"],
                  ["Approved This Month", registrationApprovedAnalytics.approvedThisMonth, "bg-blue-50 text-blue-700"],
                  ["Approved Last Month", registrationApprovedAnalytics.approvedLastMonth, "bg-slate-50 text-slate-700"],
                  ["Approved This Year", registrationApprovedAnalytics.approvedThisYear, "bg-emerald-50 text-emerald-700"],
                  ["Approved Last Year", registrationApprovedAnalytics.approvedLastYear, "bg-indigo-50 text-indigo-700"],
                  ["Without Approval Date", registrationApprovedAnalytics.approvedWithoutDate, "bg-amber-50 text-amber-700"],
                ].map(([label, value, tone]) => (
                  <article className="rounded-lg border border-slate-100 bg-slate-50/70 p-4" key={String(label)}>
                    <span className={"mb-3 inline-flex rounded-lg px-2.5 py-1 text-[11px] font-extrabold " + String(tone)}>{String(label)}</span>
                    <p className="text-[22px] font-extrabold text-slate-950">{formatNumber(Number(value))}</p>
                  </article>
                ))}
              </div>

              <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">
                Approved records without captured approval date: {formatNumber(registrationApprovedAnalytics.approvedWithoutDate)}. These records are excluded from monthly and yearly approval trend counts until a portal approval date is captured.
              </p>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="rounded-lg border border-slate-100 p-4">
                  <h3 className="text-[13px] font-extrabold text-slate-900">Monthly Approval Trend</h3>
                  <div className="mt-3 space-y-2">
                    {approvalMonthlyTrend.length ? approvalMonthlyTrend.map((item) => (
                      <button
                        className="grid w-full grid-cols-[82px_1fr_70px] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-blue-50"
                        key={item.month}
                        onClick={() => void loadApprovalDrilldown("Registration approved in " + item.month, { month: item.month })}
                        type="button"
                      >
                        <span className="text-[12px] font-bold text-slate-600">{item.month}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-600" style={{ width: String(Math.max(3, (item.count / maxApprovalMonth) * 100)) + "%" }} /></span>
                        <span className="text-right text-[12px] font-extrabold text-slate-950">{formatNumber(item.count)}</span>
                      </button>
                    )) : <p className="text-[13px] font-semibold text-slate-500">No dated monthly approval records yet.</p>}
                  </div>
                </div>

                <div className="rounded-lg border border-slate-100 p-4">
                  <h3 className="text-[13px] font-extrabold text-slate-900">Yearly Approval Trend</h3>
                  <div className="mt-3 space-y-2">
                    {approvalYearlyTrend.length ? approvalYearlyTrend.map((item) => (
                      <button
                        className="grid w-full grid-cols-[82px_1fr_70px] items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-green-50"
                        key={item.year}
                        onClick={() => void loadApprovalDrilldown("Registration approved in " + item.year, { year: item.year })}
                        type="button"
                      >
                        <span className="text-[12px] font-bold text-slate-600">{item.year}</span>
                        <span className="h-2 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-green-600" style={{ width: String(Math.max(3, (item.count / maxApprovalYear) * 100)) + "%" }} /></span>
                        <span className="text-right text-[12px] font-extrabold text-slate-950">{formatNumber(item.count)}</span>
                      </button>
                    )) : <p className="text-[13px] font-semibold text-slate-500">No dated yearly approval records yet.</p>}
                  </div>
                </div>
              </div>

              {approvalDrilldownTitle ? (
                <div className="rounded-lg border border-slate-100 p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-[13px] font-extrabold text-slate-900">{approvalDrilldownTitle}</h3>
                    <span className="text-[12px] font-bold text-slate-500">{isApprovalDrilldownLoading ? "Loading..." : formatNumber(approvalDrilldown?.facilities.length ?? 0) + " shown"}</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-[12px]">
                      <thead className="bg-slate-50 text-slate-500">
                        <tr>
                          {['Facility Name', 'HEFA NO / Facility Code', 'Category', 'LGA', 'Approval Date', 'Portal Status', 'Last Scan Date'].map((heading) => <th className="px-3 py-2 font-extrabold" key={heading}>{heading}</th>)}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {approvalDrilldown?.facilities.length ? approvalDrilldown.facilities.map((facility) => (
                          <tr key={facility.id}>
                            <td className="px-3 py-2 font-bold text-slate-900">{facility.facilityName ?? '-'}</td>
                            <td className="px-3 py-2 text-slate-600">{facility.facilityCode ?? '-'}</td>
                            <td className="px-3 py-2 text-slate-600">{facility.category ?? '-'}</td>
                            <td className="px-3 py-2 text-slate-600">{facility.lga ?? '-'}</td>
                            <td className="px-3 py-2 text-slate-600">{facility.approvalDate ? new Date(facility.approvalDate).toLocaleDateString('en-NG') : '-'}</td>
                            <td className="px-3 py-2 text-slate-600">{facility.portalStatus}</td>
                            <td className="px-3 py-2 text-slate-600">{facility.lastScanDate ? new Date(facility.lastScanDate).toLocaleDateString('en-NG') : '-'}</td>
                          </tr>
                        )) : (
                          <tr><td className="px-3 py-4 text-slate-500" colSpan={7}>No facilities found for this approval period.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 p-4 text-[13px] font-semibold text-slate-500">
              Registration approved analytics are unavailable. Run a fresh full scan to capture approval dates.
            </p>
          )}
        </section>

        <div className="grid gap-5 2xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-blue-600" />
              <h2 className="text-[17px] font-bold text-slate-950">Ask Database Questions</h2>
            </div>

            <form className="grid gap-3 xl:grid-cols-[220px_1fr_auto]" onSubmit={askQuestion}>
              <select
                className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => setQuestionCategory(event.target.value)}
                value={questionCategory}
              >
                <option value="">All categories</option>
                {tabs.map((tab) => (
                  <option key={tab.title} value={tab.title}>
                    {tab.title}
                  </option>
                ))}
              </select>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-[13px] font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="How many facilities are in Ikeja?"
                  value={question}
                />
              </div>

              <button
                className="flex h-11 min-w-[120px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={isAsking || !question.trim()}
                type="submit"
              >
                {isAsking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Activity className="h-4 w-4" />}
                Ask
              </button>
            </form>

            {questionError ? (
              <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
                <AlertTriangle className="h-4 w-4" />
                {questionError}
              </p>
            ) : null}

            {questionResult ? (
              <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50/70 p-4">
                <p className="text-[12px] font-extrabold uppercase tracking-[0.03em] text-blue-700">
                  Answer
                </p>
                <p className="mt-2 text-[15px] font-bold leading-6 text-slate-950">{questionResult.answer}</p>

                {matchedRows.length ? (
                  <div className="mt-4 overflow-hidden rounded-lg border border-blue-100 bg-white">
                    {matchedRows.map((row, index) => (
                      <div
                        className="grid gap-2 border-b border-slate-100 px-3 py-3 last:border-b-0 md:grid-cols-[34px_1fr_1fr]"
                        key={`${rowLabel(row)}-${index}`}
                      >
                        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-[12px] font-bold text-slate-600">
                          {index + 1}
                        </span>
                        <span className="text-[12px] font-bold text-slate-950">{rowLabel(row)}</span>
                        <span className="text-[12px] font-semibold text-slate-600">
                          {displayValue(row.LGA)} - {displayValue(row.Contact)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-blue-700" />
              <h2 className="text-[17px] font-bold text-slate-950">System Status</h2>
            </div>
            <div className="space-y-3">
              {[
                ["Google Workbook", tabs.length ? "Connected" : "Checking"],
                ["Database Mode", "Drive XLSX"],
                ["AI Mapping", "Gemini Ready"],
                ["Save Rule", "Preview Required"],
              ].map(([label, value]) => (
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-3" key={label}>
                  <span className="text-[12px] font-bold text-slate-600">{label}</span>
                  <span className="text-[12px] font-extrabold text-slate-950">{value}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-5 xl:grid-cols-[1fr_1fr] 2xl:grid-cols-[1fr_0.85fr_0.85fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-blue-600" />
              <h2 className="text-[17px] font-bold text-slate-950">Top Categories</h2>
            </div>
            <div className="space-y-3">
              {topCategories.map((item) => (
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2" key={item.category}>
                  <span className="truncate text-[12px] font-bold text-slate-800">{item.category}</span>
                  <span className="text-[12px] font-extrabold text-slate-950">{formatNumber(item.rows)}</span>
                </div>
              ))}
              {!topCategories.length && !isLoading ? (
                <p className="rounded-lg bg-slate-50 p-4 text-[13px] font-semibold text-slate-500">
                  No category data found.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <Database className="h-5 w-5 text-blue-700" />
              <h2 className="text-[17px] font-bold text-slate-950">Top LGAs</h2>
            </div>
            <div className="space-y-3">
              {topLgas.map((item) => (
                <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2" key={item.lga}>
                  <span className="truncate text-[12px] font-bold text-slate-800">{item.lga || "Unknown"}</span>
                  <span className="text-[12px] font-extrabold text-slate-950">{formatNumber(item.count)}</span>
                </div>
              ))}
              {!topLgas.length && !isLoading ? (
                <p className="rounded-lg bg-slate-50 p-4 text-[13px] font-semibold text-slate-500">
                  No LGA data found.
                </p>
              ) : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2 2xl:col-span-1">
            <div className="mb-4 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-amber-600" />
              <h2 className="text-[17px] font-bold text-slate-950">Recent Activity</h2>
            </div>
            <div className="space-y-3">
              {auditEntries.map((entry, index) => (
                <div className="rounded-lg bg-slate-50 px-3 py-3" key={entry.id ?? `${entry.timestamp}-${index}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-[12px] font-bold text-slate-950">{entry.actionType}</p>
                    <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold uppercase text-slate-500 ring-1 ring-slate-200">
                      {entry.status}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-[12px] font-semibold text-slate-600">
                    {entry.facilityName || entry.category || entry.details || "System action"}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold text-slate-400">{entry.timestamp}</p>
                </div>
              ))}
              {!auditEntries.length && !isLoading ? (
                <p className="rounded-lg bg-slate-50 p-4 text-[13px] font-semibold text-slate-500">
                  No audit entries yet.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
