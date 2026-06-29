"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { FormEvent, useRef, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ClipboardList,
  Database,
  Loader2,
  PlusCircle,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { AnalyticsCard } from "@/components/AnalyticsCard";
import { RecentActivitiesCard } from "@/components/RecentActivitiesCard";
import type { DatabaseQuestionResult } from "@/types/ai";
import type { SheetRow, SheetRowValue } from "@/types/sheet";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type AssistantAction = {
  label: string;
  icon: LucideIcon;
  href?: string;
  prompt?: string;
};

type SerialNumberIssue = {
  category: string;
  sheetRowNumber: number;
  currentValue: SheetRowValue;
  expectedValue: number | null;
  reason: "renumber" | "clear_empty_row_serial";
};

type SerialNumberAnalysis = {
  totalCategories: number;
  categoriesWithSerial: number;
  totalRows: number;
  issueCount: number;
  issues: SerialNumberIssue[];
};

type ApplySerialNumberFixResult = SerialNumberAnalysis & {
  applied: boolean;
  updatedCells: number;
};

type PhoneNormalizationIssue = {
  category: string;
  sheetRowNumber: number;
  facilityName: string;
  currentValue: string;
  normalizedValue: string;
  reason: "digits_only" | "local_prefix" | "country_code" | "multiple_numbers";
};

type PhoneNormalizationAnalysis = {
  totalCategories: number;
  totalRows: number;
  issueCount: number;
  categories: Array<{ category: string; issueCount: number }>;
  issues: PhoneNormalizationIssue[];
};

type ApplyPhoneNormalizationFixResult = PhoneNormalizationAnalysis & {
  applied: boolean;
  updatedCells: number;
};

type DataQualityIssue = {
  type: "missing_required_field" | "invalid_phone" | "invalid_email" | "duplicate_identity";
  category: string;
  sheetRowNumber: number;
  field: string;
  value: SheetRowValue;
  severity: "warning" | "critical";
};

type DataQualityAnalysis = {
  totalCategories: number;
  totalRows: number;
  issueCount: number;
  missingRequiredFields: number;
  invalidPhones: number;
  invalidEmails: number;
  duplicateWarnings: number;
  issues: DataQualityIssue[];
};

type CleaningIntent = "serial" | "phone" | "quality";

type CleaningResult =
  | {
      kind: "serial";
      title: string;
      answer: string;
      issueCount: number;
      affectedCategories: number;
      data: SerialNumberAnalysis;
      updatedCells?: number;
    }
  | {
      kind: "phone";
      title: string;
      answer: string;
      issueCount: number;
      affectedCategories: number;
      data: PhoneNormalizationAnalysis;
      updatedCells?: number;
    }
  | {
      kind: "quality";
      title: string;
      answer: string;
      issueCount: number;
      affectedCategories: number;
      data: DataQualityAnalysis;
    };

const assistantActions: AssistantAction[] = [
  { label: "Extract from Portal", icon: ClipboardList, href: "/data-capture" },
  { label: "Search Facility", icon: Search, prompt: "Find facility " },
  { label: "Check Duplicate", icon: ShieldCheck, href: "/duplicate-checker" },
  { label: "Generate Report", icon: BarChart3, href: "/reports" },
  { label: "Add New Category", icon: PlusCircle, href: "/categories" },
  { label: "Fix S/N Numbering", icon: Wrench, prompt: "Fix S/N numbering across all categories" },
  { label: "Quality Scan", icon: AlertTriangle, prompt: "Scan data quality across all categories" },
];

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "components/AssistantPanel.tsx"));

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-NG").format(value);
}

function displayValue(value: SheetRow[string] | SheetRowValue | undefined) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "-";
  }

  return String(value);
}

function rowTitle(row: SheetRow) {
  return displayValue(row["Facility Name"] ?? row["FACILITY NAME"] ?? row.Name ?? row["HEF/NO"]);
}

function rowMeta(row: SheetRow) {
  const category = displayValue(row.Category);
  const hefNo = displayValue(row["HEF/NO"] ?? row["HEF NO"] ?? row["REG NO"]);
  const lga = displayValue(row.LGA);

  return [category, hefNo, lga].filter((value) => value !== "-").join(" - ") || "Workbook row";
}

function detectCleaningIntent(message: string): CleaningIntent | null {
  const text = message.toLowerCase();

  if (/(s\/?n|serial|serial number|numbering|renumber|row number)/.test(text)) {
    return "serial";
  }

  if (/(phone|contact|telephone|mobile)/.test(text) && /(fix|clean|normal|format|correct|standard)/.test(text)) {
    return "phone";
  }

  if (/(quality|missing|incomplete|invalid|bad email|duplicate|database issue|clean data|data cleaning)/.test(text)) {
    return "quality";
  }

  return null;
}

function serialAnswer(data: SerialNumberAnalysis) {
  if (!data.issueCount) {
    return "S/N numbering is already aligned for the selected workbook scope.";
  }

  return (
    "I found " +
    formatNumber(data.issueCount) +
    " S/N fixes across " +
    formatNumber(data.categoriesWithSerial) +
    " categories. Review the preview before applying changes to the Google Sheet."
  );
}

function phoneAnswer(data: PhoneNormalizationAnalysis) {
  const affectedCategories = data.categories.filter((category) => category.issueCount > 0).length;

  if (!data.issueCount) {
    return "No safe phone/contact formatting fixes were found across the selected workbook scope.";
  }

  return (
    "I found " +
    formatNumber(data.issueCount) +
    " safe phone/contact fixes across " +
    formatNumber(affectedCategories) +
    " categories. Review the preview before applying changes."
  );
}

function qualityAnswer(data: DataQualityAnalysis) {
  if (!data.issueCount) {
    return "No data quality issues were found across the selected workbook scope.";
  }

  return (
    "I found " +
    formatNumber(data.issueCount) +
    " quality issues: " +
    formatNumber(data.missingRequiredFields) +
    " missing fields, " +
    formatNumber(data.invalidPhones + data.invalidEmails) +
    " bad contacts, and " +
    formatNumber(data.duplicateWarnings) +
    " duplicate warnings."
  );
}

function qualityIssueLabel(type: DataQualityIssue["type"]) {
  const labels: Record<DataQualityIssue["type"], string> = {
    missing_required_field: "Missing field",
    invalid_phone: "Invalid phone",
    invalid_email: "Invalid email",
    duplicate_identity: "Duplicate warning",
  };

  return labels[type];
}

function cleaningUpdatedCells(result: CleaningResult) {
  return result.kind === "quality" ? 0 : result.updatedCells ?? 0;
}

export function AssistantPanel() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<DatabaseQuestionResult | null>(null);
  const [cleaningResult, setCleaningResult] = useState<CleaningResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const [isApplyingCleaning, setIsApplyingCleaning] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function runCleaningIntent(intent: CleaningIntent) {
    if (intent === "serial") {
      const data = await fetchApi<SerialNumberAnalysis>("/api/cleaning/serial-numbers/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setCleaningResult({
        kind: "serial",
        title: "S/N Numbering Preview",
        answer: serialAnswer(data),
        issueCount: data.issueCount,
        affectedCategories: data.categoriesWithSerial,
        data,
      });
      return;
    }

    if (intent === "phone") {
      const data = await fetchApi<PhoneNormalizationAnalysis>("/api/cleaning/phone-normalization/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setCleaningResult({
        kind: "phone",
        title: "Phone Normalization Preview",
        answer: phoneAnswer(data),
        issueCount: data.issueCount,
        affectedCategories: data.categories.filter((category) => category.issueCount > 0).length,
        data,
      });
      return;
    }

    const data = await fetchApi<DataQualityAnalysis>("/api/cleaning/data-quality/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setCleaningResult({
      kind: "quality",
      title: "Data Quality Scan",
      answer: qualityAnswer(data),
      issueCount: data.issueCount,
      affectedCategories: data.totalCategories,
      data,
    });
  }

  async function askQuestion(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    const message = question.trim();

    if (!message) {
      inputRef.current?.focus();
      return;
    }

    setIsAsking(true);
    setError(null);
    setResult(null);
    setCleaningResult(null);

    try {
      const cleaningIntent = detectCleaningIntent(message);

      if (cleaningIntent) {
        await runCleaningIntent(cleaningIntent);
        return;
      }

      const data = await fetchApi<DatabaseQuestionResult>("/api/ai/ask-database", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: message }),
      });
      setResult(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to answer database question");
    } finally {
      setIsAsking(false);
    }
  }

  async function applyCleaningFixes() {
    if (!cleaningResult || cleaningResult.kind === "quality" || !cleaningResult.issueCount) return;

    const confirmed = window.confirm(
      "Apply " +
        formatNumber(cleaningResult.issueCount) +
        " " +
        (cleaningResult.kind === "serial" ? "S/N" : "phone/contact") +
        " fixes across all categories? This will update the connected Google Sheet.",
    );

    if (!confirmed) return;

    setIsApplyingCleaning(true);
    setError(null);

    try {
      if (cleaningResult.kind === "serial") {
        const data = await fetchApi<ApplySerialNumberFixResult>("/api/cleaning/serial-numbers/apply", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: "Admin User" }),
        });
        setCleaningResult({
          kind: "serial",
          title: "S/N Numbering Applied",
          answer: "Applied " + formatNumber(data.updatedCells) + " S/N updates across the connected Google Sheet.",
          issueCount: data.issueCount,
          affectedCategories: data.categoriesWithSerial,
          updatedCells: data.updatedCells,
          data,
        });
        return;
      }

      const data = await fetchApi<ApplyPhoneNormalizationFixResult>("/api/cleaning/phone-normalization/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user: "Admin User" }),
      });
      setCleaningResult({
        kind: "phone",
        title: "Phone Normalization Applied",
        answer: "Applied " + formatNumber(data.updatedCells) + " phone/contact updates across the connected Google Sheet.",
        issueCount: data.issueCount,
        affectedCategories: data.categories.filter((category) => category.issueCount > 0).length,
        updatedCells: data.updatedCells,
        data,
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to apply cleaning fixes");
    } finally {
      setIsApplyingCleaning(false);
    }
  }

  function usePrompt(prompt: string) {
    setQuestion(prompt);
    setResult(null);
    setCleaningResult(null);
    setError(null);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  const rows = result?.rows?.slice(0, 4) ?? [];
  const canApplyCleaning = Boolean(cleaningResult && cleaningResult.kind !== "quality" && cleaningResult.issueCount > 0);

  return (
    <aside className="space-y-4 xl:sticky xl:top-[98px]">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="mb-4 flex items-center gap-2 text-[16px] font-bold text-slate-950">
          <Sparkles className="h-4 w-4 text-blue-600" />
          AI Assistance
        </h2>

        <div className="mb-4 rounded-lg bg-slate-100 px-4 py-4 text-[12px] leading-5 text-slate-700">
          Ask live workbook questions, find HEFAMAA numbers, preview cleaning tasks, or apply confirmed safe fixes.
        </div>

        <div className="space-y-2">
          {assistantActions.map((action) => {
            const Icon = action.icon;

            if (action.href) {
              return (
                <a
                  className="flex h-10 w-full items-center gap-3 rounded-md border border-blue-200 bg-white px-4 text-left text-[12px] font-bold text-blue-700 shadow-sm transition hover:bg-blue-50"
                  href={action.href}
                  key={action.label}
                >
                  <Icon className="h-4 w-4" />
                  {action.label}
                </a>
              );
            }

            return (
              <button
                className="flex h-10 w-full items-center gap-3 rounded-md border border-blue-200 bg-white px-4 text-left text-[12px] font-bold text-blue-700 shadow-sm transition hover:bg-blue-50"
                key={action.label}
                onClick={() => action.prompt && usePrompt(action.prompt)}
                type="button"
              >
                <Icon className="h-4 w-4" />
                {action.label}
              </button>
            );
          })}
        </div>

        <form className="mt-5 flex gap-2" onSubmit={askQuestion}>
          <label className="sr-only" htmlFor="assistant-message">
            Ask me anything
          </label>
          <input
            className="h-10 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-[12px] text-slate-900 outline-none transition placeholder:text-slate-500 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            id="assistant-message"
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask me anything..."
            ref={inputRef}
            value={question}
          />
          <button
            aria-label="Send assistant message"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            disabled={isAsking || !question.trim()}
            type="submit"
          >
            {isAsking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </form>

        {error ? (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-5 text-amber-800">
            {error}
          </p>
        ) : null}

        {result ? (
          <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50/70 p-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-blue-700">Answer</p>
            <p className="mt-2 text-[12px] font-bold leading-5 text-slate-950">{result.answer}</p>

            {rows.length ? (
              <div className="mt-3 space-y-2">
                {rows.map((row, index) => (
                  <div className="rounded-md border border-blue-100 bg-white px-3 py-2" key={index}>
                    <p className="truncate text-[11px] font-extrabold text-slate-950">{rowTitle(row)}</p>
                    <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">{rowMeta(row)}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {cleaningResult ? (
          <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/80 p-3">
            <div className="flex items-start gap-2">
              {cleaningUpdatedCells(cleaningResult) > 0 ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-amber-700">{cleaningResult.title}</p>
                <p className="mt-2 text-[12px] font-bold leading-5 text-slate-950">{cleaningResult.answer}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-md bg-white px-2 py-2 text-center">
                <p className="text-[10px] font-bold text-slate-500">Issues</p>
                <p className="text-[14px] font-extrabold text-slate-950">{formatNumber(cleaningResult.issueCount)}</p>
              </div>
              <div className="rounded-md bg-white px-2 py-2 text-center">
                <p className="text-[10px] font-bold text-slate-500">Scope</p>
                <p className="text-[14px] font-extrabold text-slate-950">{formatNumber(cleaningResult.affectedCategories)}</p>
              </div>
              <div className="rounded-md bg-white px-2 py-2 text-center">
                <p className="text-[10px] font-bold text-slate-500">Updated</p>
                <p className="text-[14px] font-extrabold text-slate-950">{formatNumber(cleaningUpdatedCells(cleaningResult))}</p>
              </div>
            </div>

            {cleaningResult.kind === "serial" && cleaningResult.data.issues.length ? (
              <div className="mt-3 space-y-2">
                {cleaningResult.data.issues.slice(0, 4).map((issue, index) => (
                  <div className="rounded-md border border-amber-100 bg-white px-3 py-2" key={index}>
                    <p className="truncate text-[11px] font-extrabold text-slate-950">{issue.category}</p>
                    <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">
                      Row {issue.sheetRowNumber}: {displayValue(issue.currentValue)} to {displayValue(issue.expectedValue)}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {cleaningResult.kind === "phone" && cleaningResult.data.issues.length ? (
              <div className="mt-3 space-y-2">
                {cleaningResult.data.issues.slice(0, 4).map((issue, index) => (
                  <div className="rounded-md border border-amber-100 bg-white px-3 py-2" key={index}>
                    <p className="truncate text-[11px] font-extrabold text-slate-950">{issue.facilityName || issue.category}</p>
                    <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">
                      Row {issue.sheetRowNumber}: {issue.currentValue} to {issue.normalizedValue}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {cleaningResult.kind === "quality" && cleaningResult.data.issues.length ? (
              <div className="mt-3 space-y-2">
                {cleaningResult.data.issues.slice(0, 4).map((issue, index) => (
                  <div className="rounded-md border border-amber-100 bg-white px-3 py-2" key={index}>
                    <p className="truncate text-[11px] font-extrabold text-slate-950">{qualityIssueLabel(issue.type)} - {issue.category}</p>
                    <p className="mt-1 truncate text-[10px] font-semibold text-slate-500">
                      Row {issue.sheetRowNumber}: {issue.field} = {displayValue(issue.value)}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-3 flex gap-2">
              {canApplyCleaning ? (
                <button
                  className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 text-[11px] font-extrabold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={isApplyingCleaning}
                  onClick={() => void applyCleaningFixes()}
                  type="button"
                >
                  {isApplyingCleaning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Apply Confirmed
                </button>
              ) : null}
              <a
                className="flex h-9 flex-1 items-center justify-center rounded-md border border-amber-200 bg-white px-3 text-[11px] font-extrabold text-amber-700"
                href="/data-cleaning"
              >
                Open Cleaning
              </a>
            </div>
          </div>
        ) : null}
      </section>

      <AnalyticsCard />
      <RecentActivitiesCard />
    </aside>
  );
}
