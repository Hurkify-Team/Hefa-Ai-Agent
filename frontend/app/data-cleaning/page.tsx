"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Loader2, RefreshCw, ShieldCheck, Sparkles, TableProperties, XCircle } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import type { SheetRowValue, SheetTab } from "@/types/sheet";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type SerialNumberIssue = {
  category: string;
  serialHeader: string;
  rowIndex: number;
  sheetRowNumber: number;
  currentValue: SheetRowValue;
  expectedValue: number | null;
  reason: "renumber" | "clear_empty_row_serial";
};

type SerialNumberCategorySummary = {
  category: string;
  serialHeader: string | null;
  rowCount: number;
  nonEmptyRows: number;
  issueCount: number;
  skippedReason?: string;
};

type SerialNumberAnalysis = {
  scope: string;
  totalCategories: number;
  categoriesWithSerial: number;
  totalRows: number;
  issueCount: number;
  categories: SerialNumberCategorySummary[];
  issues: SerialNumberIssue[];
};

type ApplySerialNumberFixResult = SerialNumberAnalysis & {
  applied: boolean;
  updatedCells: number;
};

type PhoneNormalizationIssue = {
  category: string;
  contactHeader: string;
  rowIndex: number;
  sheetRowNumber: number;
  facilityName: string;
  currentValue: string;
  normalizedValue: string;
  reason: "digits_only" | "local_prefix" | "country_code" | "multiple_numbers";
};

type PhoneNormalizationCategorySummary = {
  category: string;
  contactHeader: string | null;
  rowCount: number;
  issueCount: number;
  skippedReason?: string;
};

type PhoneNormalizationAnalysis = {
  scope: string;
  totalCategories: number;
  totalRows: number;
  issueCount: number;
  categories: PhoneNormalizationCategorySummary[];
  issues: PhoneNormalizationIssue[];
};

type ApplyPhoneNormalizationFixResult = PhoneNormalizationAnalysis & {
  applied: boolean;
  updatedCells: number;
};

type PendingFixApproval = {
  kind: "serial" | "phone";
  title: string;
  problem: string;
  suggestedFix: string;
  impact: string;
  issueCount: number;
};

type DataQualityIssueType =
  | "missing_required_field"
  | "invalid_phone"
  | "invalid_email"
  | "duplicate_identity";

type DataQualityIssue = {
  type: DataQualityIssueType;
  category: string;
  rowIndex: number;
  sheetRowNumber: number;
  field: string;
  value: SheetRowValue;
  message: string;
  severity: "warning" | "critical";
  relatedRows?: Array<{
    category: string;
    rowIndex: number;
    sheetRowNumber: number;
    facilityName: string;
    field: string;
    value: string;
  }>;
};

type DataQualityCategorySummary = {
  category: string;
  rowCount: number;
  missingRequiredFields: number;
  invalidPhones: number;
  invalidEmails: number;
  duplicateWarnings: number;
  issueCount: number;
};

type DataQualityAnalysis = {
  scope: string;
  totalCategories: number;
  totalRows: number;
  issueCount: number;
  missingRequiredFields: number;
  invalidPhones: number;
  invalidEmails: number;
  duplicateWarnings: number;
  categories: DataQualityCategorySummary[];
  issues: DataQualityIssue[];
};


async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-NG").format(value);
}

function displayValue(value: SheetRowValue) {
  return value === null || value === undefined || String(value).trim() === "" ? "blank" : String(value);
}




function formatPhoneReason(reason: PhoneNormalizationIssue["reason"]) {
  const labels: Record<PhoneNormalizationIssue["reason"], string> = {
    digits_only: "Remove separators",
    local_prefix: "Add local prefix",
    country_code: "Convert country code",
    multiple_numbers: "Normalize list",
  };
  return labels[reason];
}

function formatIssueType(type: DataQualityIssueType) {
  const labels: Record<DataQualityIssueType, string> = {
    missing_required_field: "Missing field",
    invalid_phone: "Invalid phone",
    invalid_email: "Invalid email",
    duplicate_identity: "Duplicate warning",
  };
  return labels[type];
}

function severityClasses(severity: DataQualityIssue["severity"]) {
  return severity === "critical" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700";
}

export default function DataCleaningPage() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [category, setCategory] = useState("");
  const [analysis, setAnalysis] = useState<SerialNumberAnalysis | null>(null);
  const [phoneAnalysis, setPhoneAnalysis] = useState<PhoneNormalizationAnalysis | null>(null);
  const [qualityAnalysis, setQualityAnalysis] = useState<DataQualityAnalysis | null>(null);
  const [applyResult, setApplyResult] = useState<ApplySerialNumberFixResult | null>(null);
  const [phoneApplyResult, setPhoneApplyResult] = useState<ApplyPhoneNormalizationFixResult | null>(null);
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isAnalyzingPhones, setIsAnalyzingPhones] = useState(false);
  const [isScanningQuality, setIsScanningQuality] = useState(false);
  const [isDetectingAll, setIsDetectingAll] = useState(false);
  const [pendingFix, setPendingFix] = useState<PendingFixApproval | null>(null);
  const [isApplying, setIsApplying] = useState(false);
  const [isApplyingPhones, setIsApplyingPhones] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTabs() {
      setIsLoadingTabs(true);
      try {
        setTabs(await fetchApi<SheetTab[]>("/api/sheets/tabs"));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to load workbook categories");
      } finally {
        setIsLoadingTabs(false);
      }
    }
    void loadTabs();
  }, []);

  async function analyzeSerialNumbers(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setIsAnalyzing(true);
    setError(null);
    setApplyResult(null);

    try {
      setAnalysis(
        await fetchApi<SerialNumberAnalysis>("/api/cleaning/serial-numbers/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: category || undefined }),
        }),
      );
    } catch (error) {
      setAnalysis(null);
      setError(error instanceof Error ? error.message : "Unable to analyze S/N numbering");
    } finally {
      setIsAnalyzing(false);
    }
  }

  function requestSerialNumberFixes() {
    if (!analysis?.issueCount) return;

    const affectedCategories = analysis.categories.filter((item) => item.issueCount > 0).length;
    setPendingFix({
      kind: "serial",
      title: "Approve S/N numbering fixes",
      problem: formatNumber(analysis.issueCount) + " S/N cells are blank, out of sequence, or attached to empty rows across " + formatNumber(affectedCategories) + " affected categories.",
      suggestedFix: "Renumber non-empty facility rows sequentially from 1 and clear S/N values on empty facility rows.",
      impact: "This will update only detected S/N cells in " + (category || "all categories") + ". Other facility data will not be changed.",
      issueCount: analysis.issueCount,
    });
  }

  async function applySerialNumberFixes() {
    if (!analysis?.issueCount) return;

    setIsApplying(true);
    setError(null);

    try {
      const result = await fetchApi<ApplySerialNumberFixResult>("/api/cleaning/serial-numbers/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: category || undefined, user: "Admin User" }),
      });
      setApplyResult(result);
      setAnalysis(result);
      setPendingFix(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to apply S/N numbering fixes");
    } finally {
      setIsApplying(false);
    }
  }





  async function analyzePhoneNormalization() {
    setIsAnalyzingPhones(true);
    setError(null);
    setPhoneApplyResult(null);

    try {
      setPhoneAnalysis(
        await fetchApi<PhoneNormalizationAnalysis>("/api/cleaning/phone-normalization/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: category || undefined }),
        }),
      );
    } catch (error) {
      setPhoneAnalysis(null);
      setError(error instanceof Error ? error.message : "Unable to analyze phone/contact formatting");
    } finally {
      setIsAnalyzingPhones(false);
    }
  }

  function requestPhoneNormalizationFixes() {
    if (!phoneAnalysis?.issueCount) return;

    const affectedCategories = phoneAnalysis.categories.filter((item) => item.issueCount > 0).length;
    setPendingFix({
      kind: "phone",
      title: "Approve phone/contact formatting fixes",
      problem: formatNumber(phoneAnalysis.issueCount) + " contact values have formatting issues across " + formatNumber(affectedCategories) + " affected categories.",
      suggestedFix: "Normalize safe phone/contact values by removing separators, applying local prefix rules, and keeping multiple numbers readable.",
      impact: "This will update only detected contact cells in " + (category || "all categories") + ". Facility names, addresses, and other fields will not be changed.",
      issueCount: phoneAnalysis.issueCount,
    });
  }

  async function applyPhoneNormalizationFixes() {
    if (!phoneAnalysis?.issueCount) return;

    setIsApplyingPhones(true);
    setError(null);

    try {
      const result = await fetchApi<ApplyPhoneNormalizationFixResult>("/api/cleaning/phone-normalization/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: category || undefined, user: "Admin User" }),
      });
      setPhoneApplyResult(result);
      setPhoneAnalysis(result);
      setPendingFix(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to apply phone/contact fixes");
    } finally {
      setIsApplyingPhones(false);
    }
  }

  async function analyzeDataQuality() {
    setIsScanningQuality(true);
    setError(null);

    try {
      setQualityAnalysis(
        await fetchApi<DataQualityAnalysis>("/api/cleaning/data-quality/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ category: category || undefined }),
        }),
      );
    } catch (error) {
      setQualityAnalysis(null);
      setError(error instanceof Error ? error.message : "Unable to analyze data quality");
    } finally {
      setIsScanningQuality(false);
    }
  }

  async function detectAllIssues() {
    setIsDetectingAll(true);
    setError(null);
    setApplyResult(null);
    setPhoneApplyResult(null);
    setPendingFix(null);

    try {
      const body = JSON.stringify({ category: category || undefined });
      const [serial, phone, quality] = await Promise.all([
        fetchApi<SerialNumberAnalysis>("/api/cleaning/serial-numbers/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
        fetchApi<PhoneNormalizationAnalysis>("/api/cleaning/phone-normalization/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
        fetchApi<DataQualityAnalysis>("/api/cleaning/data-quality/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        }),
      ]);

      setAnalysis(serial);
      setPhoneAnalysis(phone);
      setQualityAnalysis(quality);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to detect data cleaning issues");
    } finally {
      setIsDetectingAll(false);
    }
  }

  async function applyPendingFix() {
    if (!pendingFix) return;
    if (pendingFix.kind === "serial") await applySerialNumberFixes();
    if (pendingFix.kind === "phone") await applyPhoneNormalizationFixes();
  }

  const cards = useMemo(
    () => [
      { label: "Scope", value: category || "All categories", icon: Database, className: "bg-blue-50 text-blue-700" },
      { label: "Categories", value: analysis ? formatNumber(analysis.totalCategories) : "-", icon: TableProperties, className: "bg-blue-50 text-blue-700" },
      { label: "Rows", value: analysis ? formatNumber(analysis.totalRows) : "-", icon: ShieldCheck, className: "bg-slate-100 text-slate-700" },
      { label: "Fixes", value: analysis ? formatNumber(analysis.issueCount) : "-", icon: AlertTriangle, className: analysis?.issueCount ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700" },
    ],
    [analysis, category],
  );

  const visibleIssues = analysis?.issues.slice(0, 80) ?? [];
  const categoriesWithIssues = analysis?.categories.filter((item) => item.issueCount > 0) ?? [];

  const phoneCards = useMemo(
    () => [
      { label: "Phone Fixes", value: phoneAnalysis ? formatNumber(phoneAnalysis.issueCount) : "-", className: phoneAnalysis?.issueCount ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700" },
      { label: "Categories", value: phoneAnalysis ? formatNumber(phoneAnalysis.totalCategories) : "-", className: "bg-blue-50 text-blue-700" },
      { label: "Rows Checked", value: phoneAnalysis ? formatNumber(phoneAnalysis.totalRows) : "-", className: "bg-slate-100 text-slate-700" },
      { label: "Affected Sheets", value: phoneAnalysis ? formatNumber(phoneAnalysis.categories.filter((item) => item.issueCount > 0).length) : "-", className: "bg-violet-50 text-violet-700" },
    ],
    [phoneAnalysis],
  );

  const phoneVisibleIssues = phoneAnalysis?.issues.slice(0, 80) ?? [];
  const phoneCategoriesWithIssues = phoneAnalysis?.categories.filter((item) => item.issueCount > 0) ?? [];

  const qualityCards = useMemo(
    () => [
      { label: "Quality Issues", value: qualityAnalysis ? formatNumber(qualityAnalysis.issueCount) : "-", className: qualityAnalysis?.issueCount ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700" },
      { label: "Missing Fields", value: qualityAnalysis ? formatNumber(qualityAnalysis.missingRequiredFields) : "-", className: "bg-rose-50 text-rose-700" },
      { label: "Bad Contacts", value: qualityAnalysis ? formatNumber(qualityAnalysis.invalidPhones + qualityAnalysis.invalidEmails) : "-", className: "bg-blue-50 text-blue-700" },
      { label: "Duplicate Warnings", value: qualityAnalysis ? formatNumber(qualityAnalysis.duplicateWarnings) : "-", className: "bg-violet-50 text-violet-700" },
    ],
    [qualityAnalysis],
  );

  const qualityVisibleIssues = qualityAnalysis?.issues.slice(0, 100) ?? [];
  const qualityCategoriesWithIssues = qualityAnalysis?.categories.filter((item) => item.issueCount > 0) ?? [];

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">Data Cleaning Agent</h1>
            <p className="mt-1 text-[14px] text-slate-600">Preview and apply safe cleaning tasks across all HEFAMAA categories</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="flex h-9 items-center gap-2 rounded-full border border-blue-200 bg-blue-600 px-4 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={isDetectingAll || isAnalyzing || isAnalyzingPhones || isScanningQuality || isApplying || isApplyingPhones} onClick={() => void detectAllIssues()} type="button">
              {isDetectingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              Detect All Issues
            </button>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-[12px] font-bold text-blue-700">Preview before write</span>
          </div>
        </div>

        <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={analyzeSerialNumbers}>
          <div className="grid gap-3 xl:grid-cols-[240px_1fr_auto]">
            <select className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" disabled={isLoadingTabs || isAnalyzing || isApplying} onChange={(event) => setCategory(event.target.value)} value={category}>
              <option value="">All categories</option>
              {tabs.map((tab) => <option key={tab.title} value={tab.title}>{tab.title}</option>)}
            </select>
            <div className="flex min-h-11 items-center rounded-lg border border-slate-200 bg-slate-50 px-4 text-[13px] font-semibold text-slate-600">Current task: fix S/N numbering by numbering non-empty facility rows sequentially from 1.</div>
            <button className="flex h-11 min-w-[150px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={isAnalyzing || isApplying} type="submit">
              {isAnalyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Analyze S/N
            </button>
          </div>

          {error ? <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" />{error}</p> : null}
          {applyResult ? <p className="mt-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800"><CheckCircle2 className="h-4 w-4" />Applied {formatNumber(applyResult.updatedCells)} S/N cell updates across {formatNumber(applyResult.categoriesWithSerial)} categories.</p> : null}
        </form>

        {pendingFix ? (
          <section className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-4xl">
                <div className="flex items-center gap-2 text-amber-900"><AlertTriangle className="h-5 w-5" /><h2 className="text-[17px] font-extrabold">{pendingFix.title}</h2></div>
                <div className="mt-4 grid gap-3 lg:grid-cols-3">
                  <div className="rounded-lg bg-white/80 p-3"><p className="text-[11px] font-black uppercase tracking-[0.04em] text-amber-700">Problem detected</p><p className="mt-1 text-[13px] font-semibold leading-5 text-slate-800">{pendingFix.problem}</p></div>
                  <div className="rounded-lg bg-white/80 p-3"><p className="text-[11px] font-black uppercase tracking-[0.04em] text-amber-700">Suggested fix</p><p className="mt-1 text-[13px] font-semibold leading-5 text-slate-800">{pendingFix.suggestedFix}</p></div>
                  <div className="rounded-lg bg-white/80 p-3"><p className="text-[11px] font-black uppercase tracking-[0.04em] text-amber-700">Impact</p><p className="mt-1 text-[13px] font-semibold leading-5 text-slate-800">{pendingFix.impact}</p></div>
                </div>
              </div>
              <div className="flex min-w-[220px] flex-col gap-2">
                <button className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white disabled:bg-slate-300" disabled={isApplying || isApplyingPhones} onClick={() => void applyPendingFix()} type="button">
                  {isApplying || isApplyingPhones ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve & Apply {formatNumber(pendingFix.issueCount)} Fixes
                </button>
                <button className="flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-white px-4 text-[13px] font-bold text-amber-800" onClick={() => setPendingFix(null)} type="button"><XCircle className="h-4 w-4" />Cancel</button>
              </div>
            </div>
          </section>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-4">
          {cards.map(({ icon: Icon, ...card }) => (
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={card.label}>
              <span className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${card.className}`}><Icon className="h-5 w-5" /></span>
              <h2 className="text-[12px] font-bold uppercase tracking-[0.03em] text-slate-500">{card.label}</h2>
              <p className="mt-2 break-words text-[22px] font-extrabold tracking-[-0.02em] text-slate-950">{card.value}</p>
            </article>
          ))}
        </div>

        <div className="grid gap-5 2xl:grid-cols-[0.85fr_1.15fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-[17px] font-bold text-slate-950">Category Summary</h2>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-bold text-slate-600">{analysis ? `${formatNumber(categoriesWithIssues.length)} with issues` : "Not analyzed"}</span>
            </div>
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[1fr_90px_90px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500"><span>Category</span><span>S/N</span><span>Issues</span></div>
              {(analysis?.categories ?? []).map((item) => (
                <div className="grid grid-cols-[1fr_90px_90px] border-t border-slate-200 px-4 py-3 text-[12px]" key={item.category}>
                  <span className="min-w-0"><span className="block truncate font-bold text-slate-950">{item.category}</span>{item.skippedReason ? <span className="mt-1 block truncate text-[11px] font-semibold text-amber-700">{item.skippedReason}</span> : null}</span>
                  <span className="truncate font-semibold text-slate-700">{item.serialHeader ?? "-"}</span>
                  <span className={item.issueCount ? "font-extrabold text-amber-700" : "font-semibold text-blue-700"}>{formatNumber(item.issueCount)}</span>
                </div>
              ))}
              {!analysis ? <p className="border-t border-slate-200 p-4 text-[13px] font-semibold text-slate-500">Run analysis to inspect S/N numbering across the workbook.</p> : null}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-[17px] font-bold text-slate-950">S/N Fix Preview</h2>
              <button className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!analysis?.issueCount || isApplying || isAnalyzing} onClick={() => requestSerialNumberFixes()} type="button">
                {isApplying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Apply Confirmed Fixes
              </button>
            </div>

            {visibleIssues.length ? (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <div className="grid grid-cols-[1fr_80px_105px_105px_120px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500"><span>Category</span><span>Row</span><span>Current</span><span>Expected</span><span>Reason</span></div>
                {visibleIssues.map((issue) => (
                  <div className="grid grid-cols-[1fr_80px_105px_105px_120px] border-t border-slate-200 px-4 py-3 text-[12px]" key={`${issue.category}-${issue.rowIndex}`}>
                    <span className="truncate font-bold text-slate-950">{issue.category}</span>
                    <span className="font-semibold text-slate-700">{issue.sheetRowNumber}</span>
                    <span className="truncate font-semibold text-rose-700">{displayValue(issue.currentValue)}</span>
                    <span className="truncate font-semibold text-blue-700">{issue.expectedValue ?? "blank"}</span>
                    <span className="truncate text-slate-600">{issue.reason === "renumber" ? "Renumber" : "Clear blank row"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
                <div><ShieldCheck className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 text-[13px] font-bold text-slate-800">{analysis ? "No S/N issues found" : "No preview yet"}</p><p className="mt-1 text-[12px] text-slate-500">{analysis ? "The selected scope already has aligned S/N numbering." : "Analyze all categories or a selected category before applying any changes."}</p></div>
              </div>
            )}
            {analysis && analysis.issues.length > visibleIssues.length ? <p className="mt-3 text-[12px] font-semibold text-slate-500">Showing first {formatNumber(visibleIssues.length)} of {formatNumber(analysis.issues.length)} proposed fixes.</p> : null}
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-bold text-slate-950">Phone Normalization</h2>
              <p className="mt-1 text-[13px] text-slate-600">Preview safe contact formatting fixes before updating the connected Google Sheet.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="flex h-10 min-w-[155px] items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-[13px] font-bold text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400" disabled={isAnalyzingPhones || isApplyingPhones || isApplying} onClick={() => void analyzePhoneNormalization()} type="button">
                {isAnalyzingPhones ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Analyze Phones
              </button>
              <button className="flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300" disabled={!phoneAnalysis?.issueCount || isApplyingPhones || isAnalyzingPhones} onClick={() => requestPhoneNormalizationFixes()} type="button">
                {isApplyingPhones ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Apply Phone Fixes
              </button>
            </div>
          </div>

          {phoneApplyResult ? <p className="mt-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800"><CheckCircle2 className="h-4 w-4" />Applied {formatNumber(phoneApplyResult.updatedCells)} phone/contact updates.</p> : null}

          <div className="mt-5 grid gap-4 xl:grid-cols-4">
            {phoneCards.map((card) => (
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={card.label}>
                <span className={"mb-3 inline-flex rounded-lg px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.03em] " + card.className}>{card.label}</span>
                <p className="text-[22px] font-extrabold text-slate-950">{card.value}</p>
              </article>
            ))}
          </div>

          <div className="mt-5 grid gap-5 2xl:grid-cols-[0.8fr_1.2fr]">
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[1fr_100px_90px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500"><span>Category</span><span>Column</span><span>Fixes</span></div>
              {(phoneAnalysis?.categories ?? []).slice(0, 18).map((item) => (
                <div className="grid grid-cols-[1fr_100px_90px] border-t border-slate-200 px-4 py-3 text-[12px]" key={item.category}>
                  <span className="min-w-0"><span className="block truncate font-bold text-slate-950">{item.category}</span>{item.skippedReason ? <span className="mt-1 block truncate text-[11px] font-semibold text-amber-700">{item.skippedReason}</span> : null}</span>
                  <span className="truncate font-semibold text-slate-700">{item.contactHeader ?? "-"}</span>
                  <span className={item.issueCount ? "font-extrabold text-amber-700" : "font-semibold text-blue-700"}>{formatNumber(item.issueCount)}</span>
                </div>
              ))}
              {!phoneAnalysis ? <p className="border-t border-slate-200 p-4 text-[13px] font-semibold text-slate-500">Run analysis to find contact values that can be safely normalized.</p> : null}
              {phoneAnalysis && phoneAnalysis.categories.length > 18 ? <p className="border-t border-slate-200 p-3 text-[12px] font-semibold text-slate-500">Showing first 18 of {formatNumber(phoneAnalysis.categories.length)} categories.</p> : null}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[1fr_70px_1fr_1fr_130px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500"><span>Facility</span><span>Row</span><span>Current</span><span>New</span><span>Reason</span></div>
              {phoneVisibleIssues.map((issue) => (
                <div className="grid grid-cols-[1fr_70px_1fr_1fr_130px] border-t border-slate-200 px-4 py-3 text-[12px]" key={[issue.category, issue.rowIndex, issue.contactHeader].join("-")}>
                  <span className="min-w-0"><span className="block truncate font-bold text-slate-950">{issue.facilityName || issue.category}</span><span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">{issue.category}</span></span>
                  <span className="font-semibold text-slate-700">{issue.sheetRowNumber}</span>
                  <span className="truncate font-semibold text-rose-700" title={issue.currentValue}>{issue.currentValue}</span>
                  <span className="truncate font-semibold text-blue-700" title={issue.normalizedValue}>{issue.normalizedValue}</span>
                  <span className="truncate text-slate-600">{formatPhoneReason(issue.reason)}</span>
                </div>
              ))}
              {!phoneAnalysis ? null : phoneVisibleIssues.length ? null : <p className="border-t border-slate-200 p-4 text-[13px] font-semibold text-blue-700">No safe phone/contact formatting fixes found.</p>}
              {phoneAnalysis && phoneAnalysis.issues.length > phoneVisibleIssues.length ? <p className="border-t border-slate-200 p-3 text-[12px] font-semibold text-slate-500">Showing first {formatNumber(phoneVisibleIssues.length)} of {formatNumber(phoneAnalysis.issues.length)} phone fixes.</p> : null}
            </div>
          </div>

          {phoneAnalysis ? <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] font-semibold text-slate-600">Phone analysis completed for {category || "all categories"}: {formatNumber(phoneCategoriesWithIssues.length)} categories have safe phone formatting fixes.</p> : null}
        </section>


        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-bold text-slate-950">Data Quality Scan</h2>
              <p className="mt-1 text-[13px] text-slate-600">Review missing key fields, bad contact formats, and duplicate identities across the selected scope.</p>
            </div>
            <button className="flex h-10 min-w-[170px] items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-[13px] font-bold text-blue-700 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400" disabled={isScanningQuality || isAnalyzing || isApplying} onClick={() => void analyzeDataQuality()} type="button">
              {isScanningQuality ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Analyze Quality
            </button>
          </div>

          <div className="mt-5 grid gap-4 xl:grid-cols-4">
            {qualityCards.map((card) => (
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={card.label}>
                <span className={"mb-3 inline-flex rounded-lg px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.03em] " + card.className}>{card.label}</span>
                <p className="text-[22px] font-extrabold text-slate-950">{card.value}</p>
              </article>
            ))}
          </div>

          <div className="mt-5 grid gap-5 2xl:grid-cols-[0.85fr_1.15fr]">
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[1fr_80px_80px_80px_90px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500"><span>Category</span><span>Missing</span><span>Phone</span><span>Email</span><span>Dupes</span></div>
              {(qualityAnalysis?.categories ?? []).slice(0, 18).map((item) => (
                <div className="grid grid-cols-[1fr_80px_80px_80px_90px] border-t border-slate-200 px-4 py-3 text-[12px]" key={item.category}>
                  <span className="truncate font-bold text-slate-950">{item.category}</span>
                  <span className={item.missingRequiredFields ? "font-extrabold text-rose-700" : "font-semibold text-slate-500"}>{formatNumber(item.missingRequiredFields)}</span>
                  <span className={item.invalidPhones ? "font-extrabold text-amber-700" : "font-semibold text-slate-500"}>{formatNumber(item.invalidPhones)}</span>
                  <span className={item.invalidEmails ? "font-extrabold text-amber-700" : "font-semibold text-slate-500"}>{formatNumber(item.invalidEmails)}</span>
                  <span className={item.duplicateWarnings ? "font-extrabold text-violet-700" : "font-semibold text-slate-500"}>{formatNumber(item.duplicateWarnings)}</span>
                </div>
              ))}
              {!qualityAnalysis ? <p className="border-t border-slate-200 p-4 text-[13px] font-semibold text-slate-500">Run quality analysis to inspect all categories or the selected category.</p> : null}
              {qualityAnalysis && qualityAnalysis.categories.length > 18 ? <p className="border-t border-slate-200 p-3 text-[12px] font-semibold text-slate-500">Showing first 18 of {formatNumber(qualityAnalysis.categories.length)} categories. Categories with the most issues appear first.</p> : null}
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[120px_1fr_70px_120px_1fr] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500"><span>Issue</span><span>Category</span><span>Row</span><span>Field</span><span>Value</span></div>
              {qualityVisibleIssues.map((issue) => (
                <div className="grid grid-cols-[120px_1fr_70px_120px_1fr] border-t border-slate-200 px-4 py-3 text-[12px]" key={[issue.type, issue.category, issue.rowIndex, issue.field, String(issue.value)].join("-")}>
                  <span className={"w-fit rounded-full px-2 py-1 text-[10px] font-extrabold " + severityClasses(issue.severity)}>{formatIssueType(issue.type)}</span>
                  <span className="truncate font-bold text-slate-950">{issue.category}</span>
                  <span className="font-semibold text-slate-700">{issue.sheetRowNumber}</span>
                  <span className="truncate font-semibold text-slate-700">{issue.field}</span>
                  <span className="truncate font-semibold text-slate-900" title={displayValue(issue.value)}>{displayValue(issue.value)}</span>
                </div>
              ))}
              {!qualityAnalysis ? null : qualityVisibleIssues.length ? null : <p className="border-t border-slate-200 p-4 text-[13px] font-semibold text-blue-700">No data quality issues found for the selected scope.</p>}
              {qualityAnalysis && qualityAnalysis.issues.length > qualityVisibleIssues.length ? <p className="border-t border-slate-200 p-3 text-[12px] font-semibold text-slate-500">Showing first {formatNumber(qualityVisibleIssues.length)} of {formatNumber(qualityAnalysis.issues.length)} quality issues.</p> : null}
            </div>
          </div>

          {qualityAnalysis ? <p className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] font-semibold text-slate-600">Quality scan completed for {category || "all categories"}: {formatNumber(qualityCategoriesWithIssues.length)} categories have at least one issue. This scan is read-only and does not change the Google Sheet.</p> : null}
        </section>

      </section>
    </AppShell>
  );
}
