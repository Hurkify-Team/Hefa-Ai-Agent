"use client";

import { safeFetchJson } from "@/lib/safeFetchJson";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Database,
  FileSpreadsheet,
  Globe2,
  Loader2,
  Search,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import type { SheetRow, SheetTab } from "@/types/sheet";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type FacilitySearchResult = {
  source: "active" | "old";
  sourceLabel: string;
  legacyOnly?: boolean;
  category: string;
  rowIndex: number;
  hefNo: string;
  facilityName: string;
  address: string;
  lga: string;
  contact: string;
  email: string;
  row: SheetRow;
};

type PortalFacilityRecord = {
  applicationType?: string;
  category: string;
  facilityName: string;
  hefamaaId: string;
  normalizedStatus?: string;
  recordDate?: string | null;
  registrationStatus: string;
  renewalYear: number | null;
  text: string;
  visibleFields?: Record<string, string>;
};

type PortalSearchResponse = {
  cachedFacilities: number;
  matchCount: number;
  records: PortalFacilityRecord[];
};

async function fetchApi<T>(url: string) {
  const result = await safeFetchJson<ApiResult<T>>(url);
  if (!result.ok) {
    throw new Error(result.status === 502 ? "Service temporarily unavailable" : result.error);
  }

  if (!result.data.ok) {
    throw new Error(result.data.error);
  }

  return result.data.data;
}

function formatStatus(status?: string) {
  return String(status || "unknown").replace(/_/g, " ");
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return "-";
  }

  return String(value);
}

function workbookResultKey(result: FacilitySearchResult) {
  return "workbook-" + result.source + "-" + result.category + "-" + result.rowIndex;
}

function portalResultKey(result: PortalFacilityRecord, index: number) {
  return "portal-" + result.hefamaaId + "-" + result.category + "-" + (result.renewalYear ?? "year") + "-" + index;
}

function rowEntries(row: SheetRow) {
  return Object.entries(row).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
}

function portalEntries(record: PortalFacilityRecord) {
  const fields = record.visibleFields ?? {};
  return Object.entries(fields).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
}

export default function FacilitySearchPage() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FacilitySearchResult[]>([]);
  const [portalResults, setPortalResults] = useState<PortalFacilityRecord[]>([]);
  const [portalMatchCount, setPortalMatchCount] = useState(0);
  const [portalCachedFacilities, setPortalCachedFacilities] = useState(0);
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [didRunInitialQuery, setDidRunInitialQuery] = useState(false);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function loadTabs() {
      setIsLoadingTabs(true);
      setError(null);

      try {
        setTabs(await fetchApi<SheetTab[]>("/api/sheets/tabs"));
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unable to load categories");
      } finally {
        setIsLoadingTabs(false);
      }
    }

    const initialQuery = new URLSearchParams(window.location.search).get("query");
    if (initialQuery) setQuery(initialQuery);
    void loadTabs();
  }, []);

  useEffect(() => {
    if (!query.trim() || didRunInitialQuery || isLoadingTabs) return;
    setDidRunInitialQuery(true);
    void runSearch();
  }, [didRunInitialQuery, isLoadingTabs, query]);

  const activeWorkbookResults = useMemo(() => results.filter((result) => result.source === "active").length, [results]);

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!query.trim()) {
      setResults([]);
      setPortalResults([]);
      setPortalMatchCount(0);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setError(null);
    setPortalError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams({ query: query.trim() });
      if (category) params.set("category", category);
      const portalParams = new URLSearchParams(params);
      portalParams.set("limit", "40");

      const [workbookSettled, portalSettled] = await Promise.allSettled([
        fetchApi<FacilitySearchResult[]>("/api/facilities/search?" + params.toString()),
        fetchApi<PortalSearchResponse>("/api/portal/records?" + portalParams.toString()),
      ]);

      const nextResults = workbookSettled.status === "fulfilled" ? workbookSettled.value : [];
      const nextPortal = portalSettled.status === "fulfilled" ? portalSettled.value : null;

      if (workbookSettled.status === "rejected") {
        setError(workbookSettled.reason instanceof Error ? workbookSettled.reason.message : "Unable to search workbook facilities");
      }
      if (portalSettled.status === "rejected") {
        setPortalError(portalSettled.reason instanceof Error ? portalSettled.reason.message : "Unable to search portal cache");
      }

      setResults(nextResults);
      setPortalResults(nextPortal?.records ?? []);
      setPortalMatchCount(nextPortal?.matchCount ?? 0);
      setPortalCachedFacilities(nextPortal?.cachedFacilities ?? 0);

      const firstWorkbookKey = nextResults[0] ? workbookResultKey(nextResults[0]) : null;
      const firstPortalKey = nextPortal?.records[0] ? portalResultKey(nextPortal.records[0], 0) : null;
      setExpandedKeys(new Set([firstWorkbookKey, firstPortalKey].filter(Boolean) as string[]));
    } catch (error) {
      setResults([]);
      setPortalResults([]);
      setError(error instanceof Error ? error.message : "Unable to search facilities");
    } finally {
      setIsSearching(false);
    }
  }

  function toggleKey(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">Facility Search</h1>
          <p className="mt-1 text-[14px] text-slate-600">
            Search Active Database, Old Database fallback, and the latest HEFAMAA portal scan cache
          </p>
        </div>

        <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={runSearch}>
          <div className="grid gap-3 xl:grid-cols-[220px_1fr_auto]">
            <select
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              disabled={isLoadingTabs}
              onChange={(event) => setCategory(event.target.value)}
              value={category}
            >
              <option value="">All categories</option>
              {tabs.map((tab) => (
                <option key={tab.title} value={tab.title}>{tab.title}</option>
              ))}
            </select>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-[13px] font-semibold outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search facility name, HEF/NO, LGA, address, contact, or portal ID"
                value={query}
              />
            </div>

            <button
              className="flex h-11 min-w-[140px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isSearching || !query.trim()}
              type="submit"
            >
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search All
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-blue-700">Active workbook hits</p>
              <p className="mt-1 text-[20px] font-extrabold text-blue-950">{hasSearched ? activeWorkbookResults : "-"}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-slate-500">Old database fallback</p>
              <p className="mt-1 text-[20px] font-extrabold text-slate-950">{hasSearched ? results.length - activeWorkbookResults : "-"}</p>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.04em] text-blue-700">Portal cache hits</p>
              <p className="mt-1 text-[20px] font-extrabold text-blue-950">{hasSearched ? portalMatchCount : "-"}</p>
            </div>
          </div>

          {error ? <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" />Workbook search: {error}</p> : null}
          {portalError ? <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800"><AlertTriangle className="h-4 w-4" />Portal cache search: {portalError}</p> : null}
        </form>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-blue-600" /><h2 className="text-[17px] font-bold text-slate-950">Workbook Results</h2></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-bold text-slate-600">{hasSearched ? results.length + " workbook matches" : "Ready"}</span>
          </div>

          {results.length ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <div className="min-w-[1100px]">
                <div className="grid grid-cols-[34px_120px_150px_150px_1.2fr_1.5fr_100px_130px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500"><span /><span>Source</span><span>Category</span><span>HEF/NO</span><span>Facility</span><span>Address</span><span>LGA</span><span>Contact</span></div>
                {results.map((result) => {
                  const key = workbookResultKey(result);
                  const isExpanded = expandedKeys.has(key);
                  const details = rowEntries(result.row);
                  return (
                    <article className="border-t border-slate-200" key={key}>
                      <button className="grid w-full grid-cols-[34px_120px_150px_150px_1.2fr_1.5fr_100px_130px] px-4 py-3 text-left text-[12px] text-slate-700 hover:bg-slate-50" onClick={() => toggleKey(key)} type="button">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                        <span><span className={(result.source === "active" ? "bg-blue-50 text-blue-700 ring-blue-100" : "bg-amber-50 text-amber-700 ring-amber-100") + " inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold ring-1"}>{result.source === "active" ? "Active" : "Old DB"}</span></span>
                        <span className="truncate font-bold text-slate-950">{result.category}</span>
                        <span className="truncate font-mono text-[11px] font-semibold">{result.hefNo || "-"}</span>
                        <span className="truncate font-bold text-slate-950">{result.facilityName || "-"}</span>
                        <span className="truncate">{result.address || "-"}</span>
                        <span className="truncate">{result.lga || "-"}</span>
                        <span className="truncate">{result.contact || result.email || "-"}</span>
                      </button>
                      {isExpanded ? (
                        <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[14px] font-extrabold text-slate-950">{result.facilityName || result.address || result.hefNo || "Facility Details"}</h3><p className="mt-1 text-[12px] font-semibold text-slate-500">{result.sourceLabel} - {result.category} row {result.rowIndex + 2} - {details.length} fields shown</p></div><span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-slate-600 ring-1 ring-slate-200">{result.source === "old" ? "Read-only legacy record" : "Full active workbook row"}</span></div>
                          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{details.map(([field, value]) => <div className="rounded-lg border border-slate-200 bg-white p-3" key={field}><p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">{field}</p><p className="mt-1 break-words text-[13px] font-semibold leading-5 text-slate-900">{displayValue(value)}</p></div>)}</div>
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[150px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><div><Database className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 text-[13px] font-bold text-slate-800">{hasSearched ? "No workbook records matched" : "Search Active and Old HEFAMAA workbooks"}</p><p className="mt-1 text-[12px] text-slate-500">Active database is searched first; old database appears as a read-only fallback.</p></div></div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><Globe2 className="h-5 w-5 text-blue-600" /><h2 className="text-[17px] font-bold text-slate-950">Portal Cache Results</h2></div><span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-bold text-blue-700">{hasSearched ? portalMatchCount + " portal matches" : (portalCachedFacilities || "No") + " cached"}</span></div>

          {portalResults.length ? (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <div className="min-w-[980px]">
                <div className="grid grid-cols-[34px_150px_1.2fr_160px_170px_100px_150px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500"><span /><span>Portal ID</span><span>Facility</span><span>Category</span><span>Status</span><span>Year</span><span>Application</span></div>
                {portalResults.map((record, index) => {
                  const key = portalResultKey(record, index);
                  const isExpanded = expandedKeys.has(key);
                  const details = portalEntries(record);
                  return (
                    <article className="border-t border-slate-200" key={key}>
                      <button className="grid w-full grid-cols-[34px_150px_1.2fr_160px_170px_100px_150px] px-4 py-3 text-left text-[12px] text-slate-700 hover:bg-blue-50/60" onClick={() => toggleKey(key)} type="button">
                        <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">{isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
                        <span className="truncate font-mono text-[11px] font-bold text-blue-700">{record.hefamaaId || "-"}</span>
                        <span className="truncate font-bold text-slate-950">{record.facilityName || "-"}</span>
                        <span className="truncate font-bold text-slate-800">{record.category || "-"}</span>
                        <span className="truncate capitalize">{formatStatus(record.registrationStatus || record.normalizedStatus)}</span>
                        <span className="truncate font-semibold">{record.renewalYear ?? "-"}</span>
                        <span className="truncate capitalize">{formatStatus(record.applicationType)}</span>
                      </button>
                      {isExpanded ? (
                        <div className="border-t border-slate-100 bg-blue-50/40 px-4 py-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-[14px] font-extrabold text-slate-950">{record.facilityName || "Portal Facility"}</h3><p className="mt-1 text-[12px] font-semibold text-slate-500">Portal cache - {record.category || "Unknown category"} - {details.length} visible cached fields</p></div><span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-blue-700 ring-1 ring-blue-100">Use Add New Facility to autofill this record into sheet headers</span></div>
                          {details.length ? <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">{details.slice(0, 36).map(([field, value]) => <div className="rounded-lg border border-slate-200 bg-white p-3" key={field}><p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">{field}</p><p className="mt-1 break-words text-[13px] font-semibold leading-5 text-slate-900">{displayValue(value)}</p></div>)}</div> : <p className="rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-[12px] font-semibold text-amber-800">This record has list-level portal data only. Run Full Detail Scan to cache full facility details for offline answers and autofill.</p>}
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="flex min-h-[150px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center"><div><Globe2 className="mx-auto h-8 w-8 text-slate-400" /><p className="mt-3 text-[13px] font-bold text-slate-800">{hasSearched ? "No portal cache records matched" : "Portal cache search is ready"}</p><p className="mt-1 text-[12px] text-slate-500">Quick Scan replaces the portal list cache with the newest portal data. Full Detail Scan enriches this cache with visible form fields and staff complements.</p></div></div>
          )}
        </section>
      </section>
    </AppShell>
  );
}
