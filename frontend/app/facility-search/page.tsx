"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Database,
  Loader2,
  Search,
  ShieldCheck,
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

async function fetchApi<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

export default function FacilitySearchPage() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FacilitySearchResult[]>([]);
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
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

    loadTabs();
  }, []);

  async function runSearch(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();

    if (!query.trim()) {
      setResults([]);
      setHasSearched(false);
      return;
    }

    setIsSearching(true);
    setError(null);
    setHasSearched(true);

    try {
      const params = new URLSearchParams({ query: query.trim() });
      if (category) params.set("category", category);

      const nextResults = await fetchApi<FacilitySearchResult[]>(`/api/facilities/search?${params.toString()}`);
      setResults(nextResults);
      setExpandedKeys(new Set(nextResults.slice(0, 1).map((result) => resultKey(result))));
    } catch (error) {
      setResults([]);
      setError(error instanceof Error ? error.message : "Unable to search facilities");
    } finally {
      setIsSearching(false);
    }
  }

  function resultKey(result: FacilitySearchResult) {
    return `${result.source}-${result.category}-${result.rowIndex}`;
  }

  function toggleResult(result: FacilitySearchResult) {
    const key = resultKey(result);

    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function displayValue(value: SheetRow[string]) {
    if (value === null || value === undefined || String(value).trim() === "") {
      return "-";
    }

    return String(value);
  }

  function rowEntries(row: SheetRow) {
    return Object.entries(row).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  }

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
            Facility Search
          </h1>
          <p className="mt-1 text-[14px] text-slate-600">
            Search by facility name, HEF/NO, LGA, contact, email, or address
          </p>
        </div>

        <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={runSearch}>
          <div className="grid gap-3 xl:grid-cols-[220px_1fr_auto]">
            <select
              className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              disabled={isLoadingTabs}
              onChange={(event) => setCategory(event.target.value)}
              value={category}
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
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-[13px] font-semibold outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Active first, with Old Database fallback"
                value={query}
              />
            </div>

            <button
              className="flex h-11 min-w-[120px] items-center justify-center gap-2 rounded-lg bg-emerald-600 px-5 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isSearching || !query.trim()}
              type="submit"
            >
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </button>
          </div>

          {error ? (
            <p className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
              <AlertTriangle className="h-4 w-4" />
              {error}
            </p>
          ) : null}
        </form>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              <h2 className="text-[17px] font-bold text-slate-950">Search Results</h2>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-bold text-slate-600">
              {hasSearched ? `${results.length} matches` : "Ready"}
            </span>
          </div>

          {results.length ? (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid grid-cols-[34px_120px_150px_150px_1.2fr_1.5fr_100px_130px] bg-slate-50 px-4 py-3 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                <span />
                <span>Source</span>
                <span>Category</span>
                <span>HEF/NO</span>
                <span>Facility</span>
                <span>Address</span>
                <span>LGA</span>
                <span>Contact</span>
              </div>
              {results.map((result) => {
                const key = resultKey(result);
                const isExpanded = expandedKeys.has(key);
                const details = rowEntries(result.row);

                return (
                  <article className="border-t border-slate-200" key={key}>
                    <button
                      className="grid w-full grid-cols-[34px_120px_150px_150px_1.2fr_1.5fr_100px_130px] px-4 py-3 text-left text-[12px] text-slate-700 hover:bg-slate-50"
                      onClick={() => toggleResult(result)}
                      type="button"
                    >
                      <span className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                        {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </span>
                      <span>
                        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold ring-1 ${
                          result.source === "active"
                            ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                            : "bg-amber-50 text-amber-700 ring-amber-100"
                        }`}>
                          {result.source === "active" ? "Active" : "Old DB"}
                        </span>
                      </span>
                      <span className="truncate font-bold text-slate-950">{result.category}</span>
                      <span className="truncate font-mono text-[11px] font-semibold">{result.hefNo || "-"}</span>
                      <span className="truncate font-bold text-slate-950">{result.facilityName || "-"}</span>
                      <span className="truncate">{result.address || "-"}</span>
                      <span className="truncate">{result.lga || "-"}</span>
                      <span className="truncate">{result.contact || result.email || "-"}</span>
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-slate-100 bg-slate-50/70 px-4 py-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h3 className="text-[14px] font-extrabold text-slate-950">
                              {result.facilityName || result.address || result.hefNo || "Facility Details"}
                            </h3>
                            <p className="mt-1 text-[12px] font-semibold text-slate-500">
                              {result.sourceLabel} - {result.category} row {result.rowIndex + 2} - {details.length} fields shown
                            </p>
                          </div>
                          <span className="rounded-full bg-white px-3 py-1 text-[12px] font-bold text-slate-600 ring-1 ring-slate-200">
{result.source === "old" ? "Read-only legacy record" : "Full active workbook row"}
                          </span>
                        </div>

                        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                          {details.map(([field, value]) => (
                            <div className="rounded-lg border border-slate-200 bg-white p-3" key={field}>
                              <p className="text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                                {field}
                              </p>
                              <p className="mt-1 break-words text-[13px] font-semibold leading-5 text-slate-900">
                                {displayValue(value)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-[180px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 p-6 text-center">
              <div>
                <Database className="mx-auto h-8 w-8 text-slate-400" />
                <p className="mt-3 text-[13px] font-bold text-slate-800">
                  {hasSearched ? "No matching facilities found" : "Search Active and Old HEFAMAA workbooks"}
                </p>
                <p className="mt-1 text-[12px] text-slate-500">
                  {hasSearched
                    ? "Try a facility name, HEF number, LGA, address, phone, or email."
                    : "Results are read from Active first; Old Database records are shown as read-only fallback."}
                </p>
              </div>
            </div>
          )}
        </section>
      </section>
    </AppShell>
  );
}
