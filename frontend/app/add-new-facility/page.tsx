"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  Globe2,
  Loader2,
  RefreshCw,
  Save,
  SearchCheck,
  ShieldAlert,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import type { FieldMappingResult } from "@/types/ai";
import type { DuplicateCheckResult } from "@/types/facility";
import type { SheetHeaderResult, SheetRow, SheetRowValue, SheetTab } from "@/types/sheet";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type SaveResult = {
  category: string;
  rowIndex: number;
  row: SheetRow;
};

type PortalSearchMatch = {
  category: string;
  facilityName: string;
  hasAction?: boolean;
  hefamaaId: string;
  index: number;
  registrationStatus: string;
  renewalYear: number | null;
  text?: string;
};

type PortalActionResult = {
  matches?: PortalSearchMatch[];
  selectedPortalRecord?: PortalSearchMatch | null;
  status?: string;
};

type PortalCaptureResult = {
  currentRenewalYear?: number;
  formFields: Array<{ label: string; type: string; value: string }>;
  latestAvailableRenewalYear?: number | null;
  renewalStatus?: string;
  selectedPortalRecord?: PortalSearchMatch | null;
  selectedRenewalYear?: number | null;
  tables: string[][][];
  text: string;
  url: string;
};

type LivePortalCaptureResult = {
  category: string;
  confidence: number;
  currentRenewalYear?: number;
  filledFields: string[];
  formFieldCount: number;
  matchCount: number;
  missingFields: string[];
  notes: string[];
  portalCategory: string;
  portalRecord: PortalSearchMatch | null;
  renewalStatus?: string;
  selectedRenewalYear?: number | null;
  tableCount: number;
  targetCategory: string;
  url: string;
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "app/add-new-facility/page.tsx"));

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function displayStatus(status?: DuplicateCheckResult["status"]) {
  if (status === "no_duplicate") {
    return { label: "No duplicate found", className: "border-blue-200 bg-blue-50 text-blue-800", icon: CheckCircle2 };
  }

  if (status === "exact_duplicate") {
    return { label: "Exact duplicate found", className: "border-rose-200 bg-rose-50 text-rose-800", icon: ShieldAlert };
  }

  if (status === "possible_duplicate") {
    return { label: "Possible duplicate found", className: "border-amber-200 bg-amber-50 text-amber-800", icon: AlertTriangle };
  }

  return { label: "Duplicate check required", className: "border-slate-200 bg-slate-50 text-slate-700", icon: SearchCheck };
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

function formValue(value: SheetRowValue | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function normalizeCategoryMatchValue(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function resolvePortalCategory(tabs: SheetTab[], portalCategory?: string | null) {
  if (!portalCategory) return null;

  const normalizedPortalCategory = normalizeCategoryMatchValue(portalCategory);
  if (!normalizedPortalCategory) return null;

  const exactMatch = tabs.find((tab) => normalizeCategoryMatchValue(tab.title) === normalizedPortalCategory);
  if (exactMatch) return exactMatch.title;

  return (
    tabs.find((tab) => {
      const normalizedTab = normalizeCategoryMatchValue(tab.title);
      return normalizedTab.includes(normalizedPortalCategory) || normalizedPortalCategory.includes(normalizedTab);
    })?.title ?? null
  );
}

async function readHeadersForCategory(nextCategory: string) {
  const params = new URLSearchParams({ category: nextCategory });
  return fetchApi<SheetHeaderResult>("/api/sheets/headers?" + params.toString());
}

export default function AddNewFacilityPage() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [category, setCategory] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [portalQuery, setPortalQuery] = useState("");
  const [livePortalCapture, setLivePortalCapture] = useState<LivePortalCaptureResult | null>(null);
  const [duplicateResult, setDuplicateResult] = useState<DuplicateCheckResult | null>(null);
  const [saveResult, setSaveResult] = useState<SaveResult | null>(null);
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isLoadingHeaders, setIsLoadingHeaders] = useState(false);
  const [isCapturingPortal, setIsCapturingPortal] = useState(false);
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
      const result = await readHeadersForCategory(nextCategory);
      setHeaders(result.headers);
      setValues((current) => Object.fromEntries(result.headers.map((header) => [header, current[header] ?? ""])));
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

  async function captureFromLivePortal() {
    const searchValue = (portalQuery || facilityName).trim();
    if (!searchValue) return;

    setIsCapturingPortal(true);
    setError(null);
    setLivePortalCapture(null);
    setDuplicateResult(null);
    setSaveResult(null);

    try {
      // Live capture is intentional here: many facilities are not in the portal cache yet, so the portal must be searched before mapping.
      const searchResult = await fetchApi<PortalActionResult>("/api/portal/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facilityName: searchValue }),
      });

      let portalRecord = searchResult.selectedPortalRecord ?? searchResult.matches?.find((match) => match.hasAction) ?? searchResult.matches?.[0] ?? null;

      if (!portalRecord) {
        throw new Error("No matching facility was found on the HEFAMAA portal.");
      }

      if (!searchResult.selectedPortalRecord && portalRecord.hasAction) {
        const openedRecord = await fetchApi<PortalActionResult>("/api/portal/open-record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rowIndex: portalRecord.index }),
        });
        portalRecord = openedRecord.selectedPortalRecord ?? portalRecord;
      }

      const firstCategoryMatch = resolvePortalCategory(tabs, portalRecord.category) ?? category;
      if (!firstCategoryMatch) {
        throw new Error("The portal record category could not be matched to a Google Sheet tab.");
      }

      const capture = await fetchApi<PortalCaptureResult>("/api/portal/capture", { method: "POST" });
      const capturedRecord = capture.selectedPortalRecord ?? portalRecord;
      const portalCategory = capturedRecord?.category || portalRecord.category || "";
      const targetCategory = resolvePortalCategory(tabs, portalCategory) ?? firstCategoryMatch;
      const headerResult = await readHeadersForCategory(targetCategory);

      // The selected sheet headers are the extraction contract. Gemini can only return keys from this exact list.
      const mapping = await fetchApi<FieldMappingResult>("/api/ai/map-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: targetCategory,
          headers: headerResult.headers,
          portalText: capture.text,
        }),
      });

      const nextValues = Object.fromEntries(
        headerResult.headers.map((header) => [header, formValue(mapping.matchedFields[header])]),
      );
      const filledFields = headerResult.headers.filter((header) => nextValues[header]?.trim());

      setLivePortalCapture({
        category: mapping.category,
        confidence: mapping.confidence,
        currentRenewalYear: capture.currentRenewalYear,
        filledFields,
        formFieldCount: capture.formFields.length,
        matchCount: searchResult.matches?.length ?? 0,
        missingFields: mapping.missingFields,
        notes: mapping.notes,
        portalCategory,
        portalRecord: capturedRecord,
        renewalStatus: capture.renewalStatus,
        selectedRenewalYear: capture.selectedRenewalYear,
        tableCount: capture.tables.length,
        targetCategory,
        url: capture.url,
      });
      setCategory(targetCategory);
      setHeaders(headerResult.headers);
      setValues(nextValues);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to capture live portal data");
    } finally {
      setIsCapturingPortal(false);
    }
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
          confidence: livePortalCapture?.confidence ?? 1,
          missingFields,
          saveAnyway,
        }),
      });

      setSaveResult(result);
      setDuplicateResult(null);
      setLivePortalCapture(null);
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
  const portalSearchValue = (portalQuery || facilityName).trim();

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">Add New Facility</h1>
            <p className="mt-1 text-[14px] text-slate-600">Add manually or search the live HEFAMAA portal, detect the category, and fill the matching sheet headers</p>
          </div>
          <button className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:text-slate-400" disabled={isLoadingTabs} onClick={() => void loadTabs()} type="button">
            {isLoadingTabs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh Categories
          </button>
        </div>

        {error ? <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" />{error}</p> : null}
        {saveResult ? <p className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800"><CheckCircle2 className="h-4 w-4" />Saved to {saveResult.category} on row {saveResult.rowIndex + 2}.</p> : null}

        <section className="rounded-xl border border-blue-100 bg-blue-50 p-5 shadow-sm">
          <div className="grid gap-3 xl:grid-cols-[1fr_auto]">
            <div>
              <div className="mb-3 flex items-center gap-2"><Globe2 className="h-5 w-5 text-blue-700" /><h2 className="text-[17px] font-extrabold text-blue-950">Capture from Live Portal</h2></div>
              <div className="relative">
                <SearchCheck className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-blue-500" />
                <input className="h-11 w-full rounded-lg border border-blue-200 bg-white pl-10 pr-3 text-[13px] font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" onChange={(event) => setPortalQuery(event.target.value)} placeholder="Search facility name on HEFAMAA portal" value={portalQuery} />
              </div>
              <p className="mt-2 text-[12px] font-semibold leading-5 text-blue-900">The agent searches the live portal, opens the latest/current record, resolves its category to a sheet tab, reads that sheet&apos;s headers, and leaves missing fields blank for review.</p>
            </div>
            <button className="flex h-11 min-w-[190px] items-center justify-center gap-2 self-end rounded-lg bg-blue-600 px-5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={isCapturingPortal || !portalSearchValue} onClick={() => void captureFromLivePortal()} type="button">
              {isCapturingPortal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
              Search Portal & Capture
            </button>
          </div>

          {livePortalCapture ? (
            <div className="mt-4 rounded-xl border border-blue-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-[13px] font-extrabold text-slate-950">{livePortalCapture.portalRecord?.facilityName || "Captured portal record"}</p>
                  <p className="mt-1 text-[12px] font-semibold text-slate-600">Portal category: {livePortalCapture.portalCategory || "Unknown"} - Target sheet: {livePortalCapture.targetCategory} - Portal ID: {livePortalCapture.portalRecord?.hefamaaId || "Not visible"}</p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-bold text-blue-700">{Math.round(livePortalCapture.confidence * 100)}% AI confidence</span>
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                <div className="rounded-lg bg-blue-50 px-3 py-2"><p className="text-[11px] font-black uppercase text-blue-700">Filled</p><p className="text-[18px] font-black text-blue-950">{livePortalCapture.filledFields.length}</p></div>
                <div className="rounded-lg bg-amber-50 px-3 py-2"><p className="text-[11px] font-black uppercase text-amber-700">Missing</p><p className="text-[18px] font-black text-amber-900">{livePortalCapture.missingFields.length}</p></div>
                <div className="rounded-lg bg-slate-50 px-3 py-2"><p className="text-[11px] font-black uppercase text-slate-500">Portal matches</p><p className="text-[18px] font-black text-slate-950">{livePortalCapture.matchCount}</p></div>
              </div>
              <ul className="mt-3 space-y-1 text-[12px] font-semibold leading-5 text-slate-600">{livePortalCapture.notes.map((note) => <li key={note}>- {note}</li>)}</ul>
            </div>
          ) : null}
        </section>

        <div className="grid gap-5 2xl:grid-cols-[1fr_360px]">
          <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={submitForm}>
            <div className="mb-5 grid gap-3 xl:grid-cols-[260px_1fr]">
              <label className="block text-[12px] font-bold text-slate-700">Target Category
                <select className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" disabled={isLoadingTabs} onChange={(event) => { setLivePortalCapture(null); setCategory(event.target.value); }} value={category}>
                  {tabs.map((tab) => <option key={tab.title} value={tab.title}>{tab.title}</option>)}
                </select>
              </label>

              <div className="grid gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 sm:grid-cols-3"><div><p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-blue-700">Headers</p><p className="mt-1 text-[20px] font-extrabold text-blue-950">{headers.length}</p></div><div><p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-blue-700">Filled</p><p className="mt-1 text-[20px] font-extrabold text-blue-950">{filledCount}</p></div><div><p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-blue-700">Rows</p><p className="mt-1 text-[20px] font-extrabold text-blue-950">{selectedTab?.rowCount ?? "-"}</p></div></div>
            </div>

            {isLoadingHeaders ? <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-5 text-[13px] font-semibold text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Loading category headers...</div> : (
              <div className="grid gap-4 lg:grid-cols-2">
                {headers.map((header) => {
                  const isLongField = /address|service|scope|remark|comment|note/i.test(header);
                  return (
                    <label className="block text-[12px] font-bold text-slate-700" key={header}>{header}
                      {isLongField ? <textarea className="mt-2 min-h-[88px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 text-[13px] font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" onChange={(event) => updateValue(header, event.target.value)} placeholder={"Enter " + header} value={values[header] ?? ""} /> : <input className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100" onChange={(event) => updateValue(header, event.target.value)} placeholder={"Enter " + header} value={values[header] ?? ""} />}
                    </label>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-3">
              <button className="flex h-11 items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-5 text-[13px] font-bold text-blue-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" disabled={isChecking || isSaving || !canCheck} onClick={() => void checkDuplicate()} type="button">{isChecking ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchCheck className="h-4 w-4" />}Check Duplicate</button>
              <button className="flex h-11 items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300" disabled={isChecking || isSaving || !canSaveNormally} type="submit">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save New Facility</button>
              {canSaveAnyway ? <button className="flex h-11 items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-5 text-[13px] font-bold text-amber-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" disabled={isSaving} onClick={() => void saveFacility(true)} type="button"><ShieldAlert className="h-4 w-4" />Save Anyway</button> : null}
            </div>
          </form>

          <aside className="space-y-5">
            <article className={"rounded-xl border p-5 shadow-sm " + status.className}><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/70"><StatusIcon className="h-5 w-5" /></span><div><h2 className="text-[16px] font-extrabold">{status.label}</h2><p className="mt-1 text-[12px] font-semibold leading-5">{duplicateResult ? duplicateResult.matches.length + " matching record" + (duplicateResult.matches.length === 1 ? "" : "s") + " found." : "Check duplicates before saving to the live workbook."}</p></div></div></article>
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-2"><FilePlus2 className="h-5 w-5 text-blue-600" /><h2 className="text-[17px] font-bold text-slate-950">Save Rules</h2></div><ul className="space-y-3 text-[13px] font-semibold leading-5 text-slate-600"><li>Facility Name is required before duplicate check.</li><li>The selected category controls the exact columns.</li><li>Blank fields are saved as empty cells.</li><li>Live portal capture never treats portal ID as workbook HEF/NO.</li></ul></article>
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-[17px] font-bold text-slate-950">Missing Fields</h2><span className="rounded-full bg-amber-50 px-3 py-1 text-[12px] font-bold text-amber-700">{missingFields.length}</span></div><div className="max-h-[300px] space-y-2 overflow-auto pr-1">{missingFields.slice(0, 24).map((field) => <p className="rounded-lg bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600" key={field}>{field}</p>)}{!missingFields.length ? <p className="rounded-lg bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-700">All detected headers have values.</p> : null}</div></article>
          </aside>
        </div>
      </section>
    </AppShell>
  );
}
