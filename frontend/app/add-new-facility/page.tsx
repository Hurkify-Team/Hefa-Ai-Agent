"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Loader2,
  RefreshCw,
  Save,
  SearchCheck,
  ShieldAlert,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import type { DuplicateCheckResult } from "@/types/facility";
import type { SheetHeaderResult, SheetRow, SheetTab } from "@/types/sheet";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type SaveResult = {
  category: string;
  rowIndex: number;
  row: SheetRow;
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function displayStatus(status?: DuplicateCheckResult["status"]) {
  if (status === "no_duplicate") {
    return {
      label: "No duplicate found",
      className: "border-emerald-200 bg-emerald-50 text-emerald-800",
      icon: CheckCircle2,
    };
  }

  if (status === "exact_duplicate") {
    return {
      label: "Exact duplicate found",
      className: "border-rose-200 bg-rose-50 text-rose-800",
      icon: ShieldAlert,
    };
  }

  if (status === "possible_duplicate") {
    return {
      label: "Possible duplicate found",
      className: "border-amber-200 bg-amber-50 text-amber-800",
      icon: AlertTriangle,
    };
  }

  return {
    label: "Duplicate check required",
    className: "border-slate-200 bg-slate-50 text-slate-700",
    icon: SearchCheck,
  };
}

function valueFor(row: SheetRow, headers: string[]) {
  for (const header of headers) {
    const value = row[header];
    if (value !== null && value !== undefined && String(value).trim()) {
      return String(value);
    }
  }

  return "";
}

export default function AddNewFacilityPage() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [category, setCategory] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [duplicateResult, setDuplicateResult] = useState<DuplicateCheckResult | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isLoadingHeaders, setIsLoadingHeaders] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadTabs();
  }, []);

  useEffect(() => {
    if (category) {
      void loadHeaders(category);
    }
  }, [category]);

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

  async function loadHeaders(nextCategory: string) {
    setIsLoadingHeaders(true);
    setError(null);
    setDuplicateResult(null);
    setSaveResult(null);

    try {
      const params = new URLSearchParams({ category: nextCategory });
      const result = await fetchApi<SheetHeaderResult>(`/api/sheets/headers?${params.toString()}`);
      setHeaders(result.headers);
      setValues(Object.fromEntries(result.headers.map((header) => [header, values[header] ?? ""])));
    } catch (error) {
      setHeaders([]);
      setError(error instanceof Error ? error.message : "Unable to load headers");
    } finally {
      setIsLoadingHeaders(false);
    }
  }

  function updateValue(header: string, value: string) {
    setValues((current) => ({ ...current, [header]: value }));
    setDuplicateResult(null);
    setSaveResult(null);
  }

  function sheetRowFromForm(): SheetRow {
    return Object.fromEntries(headers.map((header) => [header, values[header]?.trim() || null]));
  }

  async function checkDuplicate() {
    setIsChecking(true);
    setError(null);
    setDuplicateResult(null);
    setSaveResult(null);

    try {
      const result = await fetchApi<DuplicateCheckResult>("/api/duplicates/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, values: sheetRowFromForm() }),
      });
      setDuplicateResult(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to check duplicate");
    } finally {
      setIsChecking(false);
    }
  }

  async function saveFacility(saveAnyway = false) {
    setIsSaving(true);
    setError(null);
    setSaveResult(null);

    try {
      const result = await fetchApi<SaveResult>("/api/sheets/append", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          values: sheetRowFromForm(),
          user: "Admin User",
          confidence: 1,
          missingFields,
          saveAnyway,
        }),
      });

      setSaveResult(result);
      setDuplicateResult(null);
      setValues(Object.fromEntries(headers.map((header) => [header, ""])));
      await loadTabs();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to save facility");
    } finally {
      setIsSaving(false);
    }
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!duplicateResult) {
      await checkDuplicate();
      return;
    }

    if (duplicateResult.status === "no_duplicate") {
      await saveFacility(false);
    }
  }

  const selectedTab = tabs.find((tab) => tab.title === category);
  const row = useMemo(() => sheetRowFromForm(), [headers, values]);
  const facilityName = valueFor(row, ["Facility Name", "FACILITY NAME", "Name", "Name of Facility"]);
  const filledCount = Object.values(values).filter((value) => value.trim()).length;
  const missingFields = headers.filter((header) => !values[header]?.trim());
  const status = displayStatus(duplicateResult?.status);
  const StatusIcon = status.icon;
  const canCheck = Boolean(category && headers.length && facilityName);
  const canSaveNormally = duplicateResult?.status === "no_duplicate";
  const canSaveAnyway = duplicateResult?.status === "possible_duplicate" || duplicateResult?.status === "exact_duplicate";

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              Add New Facility
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Manually add a facility to the selected category using that sheet&apos;s exact headers
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

        {saveResult ? (
          <p className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            Saved to {saveResult.category} on row {saveResult.rowIndex + 2}.
          </p>
        ) : null}

        <div className="grid gap-5 2xl:grid-cols-[1fr_360px]">
          <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={submitForm}>
            <div className="mb-5 grid gap-3 xl:grid-cols-[260px_1fr]">
              <label className="block text-[12px] font-bold text-slate-700">
                Target Category
                <select
                  className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  disabled={isLoadingTabs}
                  onChange={(event) => setCategory(event.target.value)}
                  value={category}
                >
                  {tabs.map((tab) => (
                    <option key={tab.title} value={tab.title}>
                      {tab.title}
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-3 rounded-lg border border-emerald-100 bg-emerald-50 p-4 sm:grid-cols-3">
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-emerald-700">Headers</p>
                  <p className="mt-1 text-[20px] font-extrabold text-emerald-950">{headers.length}</p>
                </div>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-emerald-700">Filled</p>
                  <p className="mt-1 text-[20px] font-extrabold text-emerald-950">{filledCount}</p>
                </div>
                <div>
                  <p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-emerald-700">Rows</p>
                  <p className="mt-1 text-[20px] font-extrabold text-emerald-950">{selectedTab?.rowCount ?? "-"}</p>
                </div>
              </div>
            </div>

            {isLoadingHeaders ? (
              <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-5 text-[13px] font-semibold text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading category headers...
              </div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {headers.map((header) => {
                  const isLongField = /address|service|scope|remark|comment|note/i.test(header);

                  return (
                    <label className="block text-[12px] font-bold text-slate-700" key={header}>
                      {header}
                      {isLongField ? (
                        <textarea
                          className="mt-2 min-h-[88px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-[13px] font-semibold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                          onChange={(event) => updateValue(header, event.target.value)}
                          placeholder={`Enter ${header}`}
                          value={values[header] ?? ""}
                        />
                      ) : (
                        <input
                          className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                          onChange={(event) => updateValue(header, event.target.value)}
                          placeholder={`Enter ${header}`}
                          value={values[header] ?? ""}
                        />
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                className="flex h-11 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-5 text-[13px] font-bold text-emerald-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={isChecking || isSaving || !canCheck}
                onClick={() => void checkDuplicate()}
                type="button"
              >
                {isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}
                Check Duplicate
              </button>
              <button
                className="flex h-11 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={isChecking || isSaving || !canSaveNormally}
                type="submit"
              >
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save New Facility
              </button>
              {canSaveAnyway ? (
                <button
                  className="flex h-11 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-5 text-[13px] font-bold text-amber-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  disabled={isSaving}
                  onClick={() => void saveFacility(true)}
                  type="button"
                >
                  <ShieldAlert className="h-4 w-4" />
                  Save Anyway
                </button>
              ) : null}
            </div>
          </form>

          <aside className="space-y-5">
            <article className={`rounded-xl border p-5 shadow-sm ${status.className}`}>
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/70">
                  <StatusIcon className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="text-[16px] font-extrabold">{status.label}</h2>
                  <p className="mt-1 text-[12px] font-semibold leading-5">
                    {duplicateResult
                      ? `${duplicateResult.matches.length} matching record${duplicateResult.matches.length === 1 ? "" : "s"} found.`
                      : "Check duplicates before saving to the live workbook."}
                  </p>
                </div>
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <FilePlus2 className="h-5 w-5 text-emerald-600" />
                <h2 className="text-[17px] font-bold text-slate-950">Save Rules</h2>
              </div>
              <ul className="space-y-3 text-[13px] font-semibold leading-5 text-slate-600">
                <li>Facility Name is required before duplicate check.</li>
                <li>The selected category controls the exact columns.</li>
                <li>Blank fields are saved as empty cells.</li>
                <li>Duplicate warnings are logged if Save Anyway is used.</li>
              </ul>
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="text-[17px] font-bold text-slate-950">Missing Fields</h2>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-bold text-amber-700">
                  {missingFields.length}
                </span>
              </div>
              <div className="max-h-[300px] space-y-2 overflow-auto pr-1">
                {missingFields.slice(0, 24).map((field) => (
                  <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600" key={field}>
                    {field}
                  </p>
                ))}
                {!missingFields.length ? (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[12px] font-semibold text-emerald-700">
                    All detected headers have values.
                  </p>
                ) : null}
              </div>
            </article>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}
