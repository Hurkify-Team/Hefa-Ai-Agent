"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  SearchCheck,
  ShieldAlert,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import type { DuplicateCheckResult } from "@/types/facility";
import type { SheetRow, SheetTab } from "@/types/sheet";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type DuplicateForm = {
  hefNo: string;
  facilityName: string;
  address: string;
  contact: string;
  email: string;
};

const initialForm: DuplicateForm = {
  hefNo: "",
  facilityName: "",
  address: "",
  contact: "",
  email: "",
};

type DuplicateGroupRecord = {
  category: string;
  rowIndex: number;
  sheetRowNumber: number;
  facilityName: string;
  hefNo: string;
  address: string;
  lga: string;
  contact: string;
  remarkHeader: string | null;
  row: SheetRow;
};

type DuplicateReviewGroup = {
  id: string;
  type: "hef_no" | "phone" | "name_address";
  label: string;
  key: string;
  severity: "exact" | "possible";
  recordCount: number;
  categories: string[];
  records: DuplicateGroupRecord[];
  canMarkForReview: boolean;
};

type DuplicateReviewSummary = {
  scope: string;
  totalCategories: number;
  totalRows: number;
  groupCount: number;
  exactGroupCount: number;
  possibleGroupCount: number;
  groups: DuplicateReviewGroup[];
};

type MarkDuplicateReviewResult = {
  updatedCells: number;
  group: DuplicateReviewGroup;
};

type DuplicateMergeSuggestion = {
  field: string;
  keeperValue: string;
  suggestedValue: string;
  sourceCategory: string;
  sourceRowIndex: number;
  sourceSheetRowNumber: number;
  sourceFacilityName: string;
};

type DuplicateMergeConflict = {
  field: string;
  keeperValue: string;
  sourceValue: string;
  sourceCategory: string;
  sourceSheetRowNumber: number;
};

type DuplicateMergePlan = {
  group: DuplicateReviewGroup;
  keeper: DuplicateGroupRecord;
  suggestions: DuplicateMergeSuggestion[];
  conflicts: DuplicateMergeConflict[];
};

type ApplyDuplicateMergeResult = {
  updatedCells: number;
  plan: DuplicateMergePlan;
};


async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function valueText(value: SheetRow[string]) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "-";
  }

  return String(value);
}



function groupSeverityClasses(severity: DuplicateReviewGroup["severity"]) {
  return severity === "exact" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700";
}

function groupSeverityLabel(severity: DuplicateReviewGroup["severity"]) {
  return severity === "exact" ? "Exact" : "Possible";
}

function statusMeta(status?: DuplicateCheckResult["status"]) {
  if (status === "no_duplicate") {
    return {
      icon: CheckCircle2,
      label: "No Duplicate Found",
      className: "border-blue-200 bg-blue-50 text-blue-800",
      message: "No matching facility was found in the selected category.",
    };
  }

  if (status === "exact_duplicate") {
    return {
      icon: ShieldAlert,
      label: "Exact Duplicate",
      className: "border-rose-200 bg-rose-50 text-rose-800",
      message: "A strong existing match was found. Update the existing record instead of creating a new one.",
    };
  }

  if (status === "possible_duplicate") {
    return {
      icon: AlertTriangle,
      label: "Possible Duplicate",
      className: "border-amber-200 bg-amber-50 text-amber-800",
      message: "Review the matches before saving a new facility.",
    };
  }

  return {
    icon: SearchCheck,
    label: "Ready to Check",
    className: "border-slate-200 bg-white text-slate-700",
    message: "Enter enough identifying information to compare against the active category.",
  };
}

export default function DuplicateCheckerPage() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [category, setCategory] = useState("");
  const [form, setForm] = useState<DuplicateForm>(initialForm);
  const [result, setResult] = useState<DuplicateCheckResult | null>(null);
  const [workbookDuplicates, setWorkbookDuplicates] = useState<DuplicateReviewSummary | null>(null);
  const [markResult, setMarkResult] = useState<MarkDuplicateReviewResult | null>(null);
  const [mergePlan, setMergePlan] = useState<DuplicateMergePlan | null>(null);
  const [mergeResult, setMergeResult] = useState<ApplyDuplicateMergeResult | null>(null);
  const [selectedMergeFields, setSelectedMergeFields] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isChecking, setIsChecking] = useState(false);
  const [isAnalyzingWorkbook, setIsAnalyzingWorkbook] = useState(false);
  const [markingGroupId, setMarkingGroupId] = useState<string | null>(null);
  const [buildingMergeKey, setBuildingMergeKey] = useState<string | null>(null);
  const [isApplyingMerge, setIsApplyingMerge] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTabs();
  }, []);

  async function loadTabs() {
    setIsLoadingTabs(true);
    setError(null);

    try {
      const nextTabs = await fetchApi<SheetTab[]>("/api/sheets/tabs");
      setTabs(nextTabs);
      setCategory((current) => current || nextTabs[0]?.title || "");
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load categories");
    } finally {
      setIsLoadingTabs(false);
    }
  }

  async function checkDuplicate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsChecking(true);
    setError(null);
    setResult(null);
    setExpandedRows(new Set());

    try {
      const values: SheetRow = {
        "HEF/NO": form.hefNo || null,
        "Facility Name": form.facilityName || null,
        Address: form.address || null,
        Contact: form.contact || null,
        "Facility E-Mail": form.email || null,
      };

      const nextResult = await fetchApi<DuplicateCheckResult>("/api/duplicates/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, values }),
      });

      setResult(nextResult);
      setExpandedRows(new Set(nextResult.matches.slice(0, 1).map((match) => match.rowIndex)));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to check duplicates");
    } finally {
      setIsChecking(false);
    }
  }



  async function analyzeWorkbookDuplicates(scope: "all" | "selected") {
    setIsAnalyzingWorkbook(true);
    setError(null);
    setMarkResult(null);
    setMergePlan(null);
    setMergeResult(null);
    setSelectedMergeFields(new Set());
    setExpandedGroups(new Set());

    try {
      const summary = await fetchApi<DuplicateReviewSummary>("/api/duplicates/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category: scope === "selected" ? category : undefined, limit: 150 }),
      });
      setWorkbookDuplicates(summary);
      setExpandedGroups(new Set(summary.groups.slice(0, 1).map((group) => group.id)));
    } catch (error) {
      setWorkbookDuplicates(null);
      setError(error instanceof Error ? error.message : "Unable to analyze workbook duplicates");
    } finally {
      setIsAnalyzingWorkbook(false);
    }
  }

  function duplicateScopeCategory() {
    return workbookDuplicates?.scope && workbookDuplicates.scope !== "all_categories" ? workbookDuplicates.scope : undefined;
  }

  async function markGroupForReview(group: DuplicateReviewGroup) {
    if (!group.canMarkForReview) {
      setError("This duplicate group cannot be marked because none of its sheets has a Remark/Notes column.");
      return;
    }

    const confirmed = window.confirm(
      "Mark " + group.recordCount + " records for duplicate review? This writes a review note into available Remark/Notes cells.",
    );

    if (!confirmed) return;

    setMarkingGroupId(group.id);
    setError(null);

    try {
      const result = await fetchApi<MarkDuplicateReviewResult>("/api/duplicates/mark-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId: group.id, category: duplicateScopeCategory(), user: "Admin User" }),
      });
      setMarkResult(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to mark duplicate group for review");
    } finally {
      setMarkingGroupId(null);
    }
  }


  async function buildMergePlan(group: DuplicateReviewGroup, keeper: DuplicateGroupRecord) {
    const mergeKey = group.id + "|" + keeper.category + "|" + keeper.rowIndex;
    setBuildingMergeKey(mergeKey);
    setError(null);
    setMergeResult(null);

    try {
      const plan = await fetchApi<DuplicateMergePlan>("/api/duplicates/merge-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: group.id,
          keeperCategory: keeper.category,
          keeperRowIndex: keeper.rowIndex,
          category: duplicateScopeCategory(),
        }),
      });
      setMergePlan(plan);
      setSelectedMergeFields(new Set(plan.suggestions.map((suggestion) => suggestion.field)));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to build duplicate merge plan");
    } finally {
      setBuildingMergeKey(null);
    }
  }

  function toggleMergeField(field: string) {
    setSelectedMergeFields((current) => {
      const next = new Set(current);

      if (next.has(field)) {
        next.delete(field);
      } else {
        next.add(field);
      }

      return next;
    });
  }

  async function applyMergePlan() {
    if (!mergePlan || !selectedMergeFields.size) return;

    const confirmed = window.confirm(
      "Apply " + selectedMergeFields.size + " selected duplicate merge update(s) to the keeper row? This writes only those fields to Google Sheets.",
    );

    if (!confirmed) return;

    setIsApplyingMerge(true);
    setError(null);

    try {
      const result = await fetchApi<ApplyDuplicateMergeResult>("/api/duplicates/apply-merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupId: mergePlan.group.id,
          keeperCategory: mergePlan.keeper.category,
          keeperRowIndex: mergePlan.keeper.rowIndex,
          selectedFields: [...selectedMergeFields],
          category: duplicateScopeCategory(),
          user: "Admin User",
        }),
      });
      setMergeResult(result);
      setMergePlan(result.plan);
      setSelectedMergeFields(new Set());
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to apply duplicate merge plan");
    } finally {
      setIsApplyingMerge(false);
    }
  }

  function toggleGroup(groupId: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  }

  function updateField(field: keyof DuplicateForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
    setResult(null);
  }

  function toggleRow(rowIndex: number) {
    setExpandedRows((current) => {
      const next = new Set(current);

      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }

      return next;
    });
  }


  const duplicateSummaryCards = useMemo(
    () => [
      { label: "Groups", value: workbookDuplicates ? String(workbookDuplicates.groupCount) : "-", className: workbookDuplicates?.groupCount ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700" },
      { label: "Exact", value: workbookDuplicates ? String(workbookDuplicates.exactGroupCount) : "-", className: "bg-rose-50 text-rose-700" },
      { label: "Possible", value: workbookDuplicates ? String(workbookDuplicates.possibleGroupCount) : "-", className: "bg-blue-50 text-blue-700" },
      { label: "Rows Checked", value: workbookDuplicates ? String(workbookDuplicates.totalRows) : "-", className: "bg-slate-100 text-slate-700" },
    ],
    [workbookDuplicates],
  );

  const canCheck = Boolean(category && (form.hefNo || form.facilityName || form.address || form.contact || form.email));
  const selectedTab = tabs.find((tab) => tab.title === category);
  const meta = statusMeta(result?.status);
  const StatusIcon = meta.icon;
  const nonEmptyMatchRows = useMemo(
    () =>
      (result?.matches ?? []).map((match) => ({
        ...match,
        entries: Object.entries(match.row).filter(([, value]) => value !== null && value !== undefined && String(value).trim()),
      })),
    [result],
  );

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              Duplicate Checker
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Compare a facility against existing records in the selected HEFAMAA category
            </p>
          </div>
          <button
            className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={isLoadingTabs}
            onClick={() => void loadTabs()}
            type="button"
          >
            {isLoadingTabs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh Categories
          </button>
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        <div className="grid gap-5 2xl:grid-cols-[0.78fr_1.22fr]">
          <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={checkDuplicate}>
            <div className="mb-5 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[17px] font-bold text-slate-950">Facility Identity</h2>
                <p className="mt-1 text-[12px] font-semibold text-slate-500">
                  {selectedTab ? `${selectedTab.rowCount} records in ${selectedTab.title}` : "Select category"}
                </p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-bold text-blue-700">
                Category Based
              </span>
            </div>

            <label className="block text-[12px] font-bold text-slate-700">
              Category
              <select
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                disabled={isLoadingTabs}
                onChange={(event) => {
                  setCategory(event.target.value);
                  setResult(null);
                }}
                value={category}
              >
                {tabs.map((tab) => (
                  <option key={tab.title} value={tab.title}>
                    {tab.title}
                  </option>
                ))}
              </select>
            </label>

            <div className="mt-4 grid gap-4">
              {[
                ["hefNo", "HEF/NO"],
                ["facilityName", "Facility Name"],
                ["address", "Address"],
                ["contact", "Contact / Phone"],
                ["email", "Facility E-Mail"],
              ].map(([field, label]) => (
                <label className="block text-[12px] font-bold text-slate-700" key={field}>
                  {label}
                  <input
                    className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    onChange={(event) => updateField(field as keyof DuplicateForm, event.target.value)}
                    placeholder={`Enter ${label}`}
                    value={form[field as keyof DuplicateForm]}
                  />
                </label>
              ))}
            </div>

            <button
              className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isChecking || !canCheck}
              type="submit"
            >
              {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
              {isChecking ? "Checking..." : "Check Duplicate"}
            </button>
          </form>

          <section className="space-y-5">
            <article className={`rounded-xl border p-5 shadow-sm ${meta.className}`}>
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-white/70">
                  <StatusIcon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-[17px] font-extrabold">{meta.label}</h2>
                  <p className="mt-1 text-[13px] font-semibold leading-5">{meta.message}</p>
                  {result ? (
                    <p className="mt-2 text-[12px] font-bold">
                      {result.matches.length} match{result.matches.length === 1 ? "" : "es"} reviewed
                    </p>
                  ) : null}
                </div>
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-[17px] font-bold text-slate-950">Match Details</h2>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-bold text-slate-600">
                  {result ? `${result.matches.length} matches` : "No check yet"}
                </span>
              </div>

              {nonEmptyMatchRows.length ? (
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <div className="grid grid-cols-[44px_88px_1fr_160px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                    <span />
                    <span>Score</span>
                    <span>Facility</span>
                    <span>Reasons</span>
                  </div>
                  {nonEmptyMatchRows.map((match) => {
                    const isExpanded = expandedRows.has(match.rowIndex);

                    return (
                      <article className="border-t border-slate-200" key={match.rowIndex}>
                        <button
                          className="grid w-full grid-cols-[44px_88px_1fr_160px] items-center px-4 py-3 text-left text-[12px] text-slate-700 hover:bg-slate-50"
                          onClick={() => toggleRow(match.rowIndex)}
                          type="button"
                        >
                          <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </span>
                          <span className="font-extrabold text-slate-950">{Math.round(match.score * 100)}%</span>
                          <span className="min-w-0">
                            <span className="block truncate font-bold text-slate-950">
                              {valueText(match.row["Facility Name"] ?? match.row.Name)}
                            </span>
                            <span className="block truncate text-[11px] font-semibold text-slate-500">
                              Row {match.rowIndex + 2} - {valueText(match.row["HEF/NO"])}
                            </span>
                          </span>
                          <span className="truncate font-semibold text-slate-600">{match.reasons.join(", ")}</span>
                        </button>

                        {isExpanded ? (
                          <div className="grid gap-3 border-t border-slate-100 bg-slate-50 p-4 md:grid-cols-2 xl:grid-cols-3">
                            {match.entries.map(([header, value]) => (
                              <div className="rounded-lg border border-slate-200 bg-white p-3" key={header}>
                                <p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-400">
                                  {header}
                                </p>
                                <p className="mt-1 break-words text-[12px] font-semibold text-slate-800">
                                  {valueText(value)}
                                </p>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="rounded-lg border border-slate-200 bg-slate-50 p-5 text-[13px] font-semibold text-slate-500">
                  {result ? "No matching records were found." : "Run a duplicate check to see possible matches here."}
                </p>
              )}
            </article>
          </section>
        </div>


        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[18px] font-bold text-slate-950">Workbook Duplicate Review</h2>
              <p className="mt-1 text-[13px] text-slate-600">Scan live Google Sheet records across all categories, compare duplicate groups, and mark groups for manual review.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:text-slate-400" disabled={isAnalyzingWorkbook} onClick={() => void analyzeWorkbookDuplicates("selected")} type="button">
                {isAnalyzingWorkbook ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Scan Selected
              </button>
              <button className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300" disabled={isAnalyzingWorkbook} onClick={() => void analyzeWorkbookDuplicates("all")} type="button">
                {isAnalyzingWorkbook ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
                Scan All Categories
              </button>
            </div>
          </div>

          {markResult ? <p className="mt-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800"><CheckCircle2 className="h-4 w-4" />Marked {markResult.updatedCells} duplicate-review cells for {markResult.group.label}.</p> : null}
          {mergeResult ? <p className="mt-4 flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800"><CheckCircle2 className="h-4 w-4" />Applied {mergeResult.updatedCells} supervised duplicate update{mergeResult.updatedCells === 1 ? "" : "s"} to {mergeResult.plan.keeper.facilityName || "the keeper row"}.</p> : null}

          <div className="mt-5 grid gap-4 xl:grid-cols-4">
            {duplicateSummaryCards.map((card) => (
              <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm" key={card.label}>
                <span className={"mb-3 inline-flex rounded-lg px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.03em] " + card.className}>{card.label}</span>
                <p className="text-[22px] font-extrabold text-slate-950">{card.value}</p>
              </article>
            ))}
          </div>

          <div className="mt-5 overflow-hidden rounded-lg border border-slate-200">
            <div className="grid grid-cols-[44px_110px_1fr_130px_150px_150px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
              <span />
              <span>Severity</span>
              <span>Duplicate Key</span>
              <span>Records</span>
              <span>Categories</span>
              <span>Action</span>
            </div>

            {(workbookDuplicates?.groups ?? []).map((group) => {
              const isExpanded = expandedGroups.has(group.id);

              return (
                <article className="border-t border-slate-200" key={group.id}>
                  <div className="grid grid-cols-[44px_110px_1fr_130px_150px_150px] items-center px-4 py-3 text-[12px] text-slate-700">
                    <button className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500" onClick={() => toggleGroup(group.id)} type="button">
                      {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    <span className={"w-fit rounded-full px-2 py-1 text-[10px] font-extrabold " + groupSeverityClasses(group.severity)}>{groupSeverityLabel(group.severity)}</span>
                    <span className="min-w-0"><span className="block truncate font-bold text-slate-950">{group.label}</span><span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">{group.key}</span></span>
                    <span className="font-extrabold text-slate-950">{group.recordCount}</span>
                    <span className="truncate font-semibold text-slate-600">{group.categories.join(", ")}</span>
                    <button className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-400" disabled={!group.canMarkForReview || markingGroupId === group.id} onClick={() => void markGroupForReview(group)} type="button">
                      {markingGroupId === group.id ? "Marking..." : group.canMarkForReview ? "Mark Review" : "No Remark Col"}
                    </button>
                  </div>

                  {isExpanded ? (
                    <div className="border-t border-slate-100 bg-slate-50 p-4">
                      <div className="grid gap-3 lg:grid-cols-2">
                        {group.records.map((record) => {
                          const mergeKey = group.id + "|" + record.category + "|" + record.rowIndex;

                          return (
                          <article className="rounded-lg border border-slate-200 bg-white p-4" key={record.category + record.rowIndex}>
                            <div className="mb-3 flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <h3 className="truncate text-[13px] font-extrabold text-slate-950">{record.facilityName || "Unnamed Facility"}</h3>
                                <p className="mt-1 text-[11px] font-semibold text-slate-500">{record.category} - Row {record.sheetRowNumber}</p>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-2">
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{record.hefNo || "No HEF/NO"}</span>
                                <button className="h-8 rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[11px] font-extrabold text-blue-700 disabled:cursor-not-allowed disabled:text-slate-400" disabled={buildingMergeKey === mergeKey} onClick={() => void buildMergePlan(group, record)} type="button">
                                  {buildingMergeKey === mergeKey ? "Building..." : "Use as Keeper"}
                                </button>
                              </div>
                            </div>
                            <dl className="grid gap-2 text-[12px]">
                              {[
                                ["Address", record.address],
                                ["LGA", record.lga],
                                ["Contact", record.contact],
                                ["Remark Column", record.remarkHeader || "Not available"],
                              ].map(([label, value]) => (
                                <div className="grid grid-cols-[95px_1fr] gap-3" key={label}>
                                  <dt className="font-bold text-slate-500">{label}</dt>
                                  <dd className="break-words font-semibold text-slate-900">{value || "-"}</dd>
                                </div>
                              ))}
                            </dl>
                          </article>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                </article>
              );
            })}

            {!workbookDuplicates ? <p className="border-t border-slate-200 p-5 text-[13px] font-semibold text-slate-500">Run a workbook duplicate scan to review duplicate groups.</p> : null}
            {workbookDuplicates && !workbookDuplicates.groups.length ? <p className="border-t border-slate-200 p-5 text-[13px] font-semibold text-blue-700">No duplicate groups found in this scope.</p> : null}
            {workbookDuplicates && workbookDuplicates.groupCount > workbookDuplicates.groups.length ? <p className="border-t border-slate-200 p-3 text-[12px] font-semibold text-slate-500">Showing first {workbookDuplicates.groups.length} of {workbookDuplicates.groupCount} duplicate groups.</p> : null}
          </div>

          {mergePlan ? (
            <article className="mt-5 rounded-xl border border-blue-200 bg-blue-50/40 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-[17px] font-extrabold text-slate-950">Supervised Duplicate Merge Plan</h3>
                  <p className="mt-1 text-[13px] font-semibold text-slate-600">
                    Keeper: {mergePlan.keeper.facilityName || "Unnamed Facility"} - {mergePlan.keeper.category}, row {mergePlan.keeper.sheetRowNumber}
                  </p>
                </div>
                <button className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300" disabled={isApplyingMerge || !selectedMergeFields.size} onClick={() => void applyMergePlan()} type="button">
                  {isApplyingMerge ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Apply Selected Updates
                </button>
              </div>

              <div className="mt-4 grid gap-4 2xl:grid-cols-[1.2fr_0.8fr]">
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
                  <div className="grid grid-cols-[44px_180px_1fr_1fr_170px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                    <span />
                    <span>Field</span>
                    <span>Keeper Value</span>
                    <span>Suggested Value</span>
                    <span>Source</span>
                  </div>
                  {mergePlan.suggestions.map((suggestion) => (
                    <label className="grid grid-cols-[44px_180px_1fr_1fr_170px] items-start gap-0 border-t border-slate-100 px-4 py-3 text-[12px]" key={suggestion.field}>
                      <span><input checked={selectedMergeFields.has(suggestion.field)} className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" onChange={() => toggleMergeField(suggestion.field)} type="checkbox" /></span>
                      <span className="font-extrabold text-slate-950">{suggestion.field}</span>
                      <span className="break-words font-semibold text-slate-500">{suggestion.keeperValue || "Blank"}</span>
                      <span className="break-words font-semibold text-slate-900">{suggestion.suggestedValue}</span>
                      <span className="break-words font-semibold text-slate-600">{suggestion.sourceCategory}, row {suggestion.sourceSheetRowNumber}</span>
                    </label>
                  ))}
                  {!mergePlan.suggestions.length ? <p className="border-t border-slate-100 p-4 text-[13px] font-semibold text-slate-500">No blank keeper fields can be safely filled from this duplicate group.</p> : null}
                </div>

                <div className="rounded-lg border border-amber-200 bg-white p-4">
                  <h4 className="text-[13px] font-extrabold text-slate-950">Conflicting Filled Fields</h4>
                  <p className="mt-1 text-[12px] font-semibold text-slate-500">These are shown for review only. The agent does not overwrite filled values automatically.</p>
                  <div className="mt-3 max-h-[360px] space-y-2 overflow-auto pr-1">
                    {mergePlan.conflicts.map((conflict) => (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12px]" key={conflict.field + conflict.sourceCategory + conflict.sourceSheetRowNumber}>
                        <p className="font-extrabold text-slate-950">{conflict.field}</p>
                        <p className="mt-1 break-words font-semibold text-slate-600">Keeper: {conflict.keeperValue}</p>
                        <p className="mt-1 break-words font-semibold text-slate-600">Source: {conflict.sourceValue}</p>
                        <p className="mt-1 text-[11px] font-bold text-amber-700">{conflict.sourceCategory}, row {conflict.sourceSheetRowNumber}</p>
                      </div>
                    ))}
                    {!mergePlan.conflicts.length ? <p className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-[12px] font-semibold text-blue-700">No conflicting filled fields found.</p> : null}
                  </div>
                </div>
              </div>
            </article>
          ) : null}

        </section>

      </section>
    </AppShell>
  );
}
