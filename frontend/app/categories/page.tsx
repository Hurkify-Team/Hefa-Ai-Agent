"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { FormEvent, useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FolderPlus,
  Loader2,
  Plus,
  RefreshCw,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";
import type { SheetHeaderResult, SheetTab } from "@/types/sheet";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "app/categories/page.tsx"));

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function parseHeaderLines(value: string) {
  return value
    .split(/\r?\n/)
    .map((header) => header.trim())
    .filter(Boolean);
}

export default function CategoriesPage() {
  const [tabs, setTabs] = useState<SheetTab[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [headerInput, setHeaderInput] = useState("");
  const [isLoadingTabs, setIsLoadingTabs] = useState(true);
  const [isLoadingHeaders, setIsLoadingHeaders] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    void loadTabs();
  }, []);

  useEffect(() => {
    if (selectedCategory) {
      void loadHeaders(selectedCategory);
    } else {
      setHeaders([]);
    }
  }, [selectedCategory]);

  async function loadTabs(preferredCategory?: string) {
    setIsLoadingTabs(true);
    setError(null);

    try {
      const nextTabs = await fetchApi<SheetTab[]>("/api/sheets/tabs");
      setTabs(nextTabs);

      const nextCategory =
        preferredCategory ||
        (selectedCategory && nextTabs.some((tab) => tab.title === selectedCategory) ? selectedCategory : "") ||
        nextTabs[0]?.title ||
        "";

      setSelectedCategory(nextCategory);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load categories");
    } finally {
      setIsLoadingTabs(false);
    }
  }

  async function loadHeaders(category: string) {
    setIsLoadingHeaders(true);
    setError(null);

    try {
      const params = new URLSearchParams({ category });
      const result = await fetchApi<SheetHeaderResult>(`/api/sheets/headers?${params.toString()}`);
      setHeaders(result.headers);
    } catch (error) {
      setHeaders([]);
      setError(error instanceof Error ? error.message : "Unable to load category headers");
    } finally {
      setIsLoadingHeaders(false);
    }
  }

  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextHeaders = parseHeaderLines(headerInput);

    setIsCreating(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await fetchApi<SheetHeaderResult>("/api/sheets/create-sheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: categoryName,
          headers: nextHeaders,
        }),
      });

      setCategoryName("");
      setHeaderInput("");
      setSuccess(`${result.category} created with ${result.headers.length} headers`);
      await loadTabs(result.category);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to create category");
    } finally {
      setIsCreating(false);
    }
  }

  const selectedTab = tabs.find((tab) => tab.title === selectedCategory);
  const parsedHeaders = parseHeaderLines(headerInput);

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              Manage Categories
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Workbook tabs are treated as HEFAMAA facility categories
            </p>
          </div>
          <button
            className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={isLoadingTabs}
            onClick={() => void loadTabs()}
            type="button"
          >
            {isLoadingTabs ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-800">
            <CheckCircle2 className="h-4 w-4" />
            {success}
          </p>
        ) : null}

        <div className="grid gap-5 2xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-blue-600" />
                <h2 className="text-[17px] font-bold text-slate-950">Active Workbook Categories</h2>
              </div>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-bold text-slate-600">
                {isLoadingTabs ? "Loading" : `${tabs.length} tabs`}
              </span>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid gap-3 bg-slate-50 p-4 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500 xl:grid-cols-[1fr_120px_120px_96px]">
                <span>Category</span>
                <span>Headers</span>
                <span>Rows</span>
                <span>Status</span>
              </div>

              {tabs.map((tab) => {
                const isSelected = tab.title === selectedCategory;

                return (
                  <button
                    className={`grid w-full gap-3 border-t border-slate-200 p-4 text-left xl:grid-cols-[1fr_120px_120px_96px] ${
                      isSelected ? "bg-blue-50/70" : "bg-white hover:bg-slate-50"
                    }`}
                    key={tab.title}
                    onClick={() => setSelectedCategory(tab.title)}
                    type="button"
                  >
                    <span className="text-[13px] font-bold text-slate-950">{tab.title}</span>
                    <span className="text-[12px] font-semibold text-slate-600">{tab.headerCount} headers</span>
                    <span className="text-[12px] font-semibold text-slate-600">{tab.rowCount} rows</span>
                    <span
                      className={`w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${
                        isSelected ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      {isSelected ? "Active" : "Ready"}
                    </span>
                  </button>
                );
              })}

              {!tabs.length && !error ? (
                <p className="border-t border-slate-200 p-4 text-[13px] font-semibold text-slate-500">
                  Loading categories...
                </p>
              ) : null}
            </div>
          </section>

          <section className="space-y-5">
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-[17px] font-bold text-slate-950">Selected Category Headers</h2>
                  <p className="mt-1 text-[12px] font-semibold text-slate-500">
                    {selectedCategory || "Select a category"} {selectedTab ? `- ${selectedTab.rowCount} rows` : ""}
                  </p>
                </div>
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[12px] font-bold text-blue-700">
                  {headers.length} fields
                </span>
              </div>

              <div className="max-h-[410px] overflow-auto rounded-lg border border-slate-200">
                {isLoadingHeaders ? (
                  <div className="flex items-center gap-2 p-4 text-[13px] font-semibold text-slate-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Reading headers...
                  </div>
                ) : headers.length ? (
                  headers.map((header, index) => (
                    <div
                      className="grid grid-cols-[42px_1fr] border-b border-slate-200 last:border-b-0"
                      key={`${header}-${index}`}
                    >
                      <span className="bg-slate-50 px-3 py-3 text-[12px] font-bold text-slate-500">
                        {index + 1}
                      </span>
                      <span className="px-3 py-3 text-[13px] font-bold text-slate-950">{header}</span>
                    </div>
                  ))
                ) : (
                  <p className="p-4 text-[13px] font-semibold text-slate-500">
                    No headers loaded for this category.
                  </p>
                )}
              </div>
            </article>

            <form className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" onSubmit={createCategory}>
              <div className="mb-4 flex items-center gap-2">
                <FolderPlus className="h-5 w-5 text-blue-600" />
                <h2 className="text-[17px] font-bold text-slate-950">Add New Category Sheet</h2>
              </div>

              <label className="block text-[12px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                Category Name
              </label>
              <input
                className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => setCategoryName(event.target.value)}
                placeholder="RADIOLOGY CENTRE"
                value={categoryName}
              />

              <label className="mt-4 block text-[12px] font-extrabold uppercase tracking-[0.03em] text-slate-500">
                Headers
              </label>
              <textarea
                className="mt-2 min-h-[180px] w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-3 font-mono text-[12px] font-semibold leading-5 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                onChange={(event) => setHeaderInput(event.target.value)}
                placeholder={"HEF/NO\nFacility Name\nAddress\nLGA\nLCDA\nContact\nScope of Service"}
                value={headerInput}
              />

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[12px] font-semibold text-slate-500">
                  {parsedHeaders.length} headers ready. One header per line.
                </p>
                <button
                  className="flex h-10 min-w-[150px] items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={isCreating || !categoryName.trim() || !parsedHeaders.length}
                  type="submit"
                >
                  {isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Create Sheet
                </button>
              </div>
            </form>
          </section>
        </div>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-[17px] font-bold text-slate-950">Category Rules</h2>
          <div className="mt-4 grid gap-3 xl:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-[13px] font-bold text-slate-950">Selected tab controls extraction</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">
                The active category decides which sheet receives captured facility data.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-[13px] font-bold text-slate-950">Headers control AI mapping</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">
                Only fields listed in row 1 are allowed in extracted results.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-[13px] font-bold text-slate-950">No hardcoded categories</p>
              <p className="mt-1 text-[12px] leading-5 text-slate-600">
                New sheets become available immediately after creation.
              </p>
            </div>
          </div>
        </section>
      </section>
    </AppShell>
  );
}
