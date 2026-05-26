import { ChevronDown, KeyRound } from "lucide-react";
import { sheetHeaders } from "@/lib/mockData";
import type { SheetTab } from "@/types/sheet";

type CategoryCardProps = {
  activeCategory?: string;
  headers?: string[];
  tabs?: SheetTab[];
  isLoading?: boolean;
  error?: string | null;
  onCategoryChange?: (category: string) => void;
};

export function CategoryCard({
  activeCategory = "LABORATORY",
  headers = sheetHeaders,
  tabs = [],
  isLoading = false,
  error = null,
  onCategoryChange,
}: CategoryCardProps) {
  const displayedHeaders = headers.slice(0, 10);
  const headerCount = headers.length;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-5">
        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-slate-950">
          1. Current Category{" "}
          <span className="text-[13px] font-medium text-slate-700">(Active Sheet)</span>
        </h2>
      </div>

      <div className="relative">
        <select
          aria-label="Select active facility category"
          className="h-12 w-full appearance-none rounded-lg border border-slate-200 bg-white px-4 pr-10 text-left text-[15px] font-bold text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          disabled={isLoading || tabs.length === 0}
          onChange={(event) => onCategoryChange?.(event.target.value)}
          value={activeCategory}
        >
          {tabs.length ? (
            tabs.map((tab) => (
              <option key={tab.title} value={tab.title}>
                {tab.title}
              </option>
            ))
          ) : (
            <option value={activeCategory}>
              {isLoading ? "Loading categories..." : activeCategory}
            </option>
          )}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
      </div>

      {error ? (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold leading-4 text-amber-800">
          {error}
        </div>
      ) : null}

      <div className="my-4 flex justify-center border-b border-slate-200 pb-4">
        <span className="rounded-md bg-emerald-100 px-4 py-2 text-[12px] font-bold text-emerald-800">
          {headerCount} Columns Detected
        </span>
      </div>

      <div className="mb-3">
        <h3 className="text-[14px] font-bold text-slate-950">
          Sheet Headers (Fields to Extract)
        </h3>
        <p className="mt-1 text-[11px] text-slate-500">
          These headers will guide the AI on what data to look for.
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        {displayedHeaders.map((header, index) => (
          <div
            className="flex min-h-9 items-center gap-3 border-b border-slate-200 bg-white px-3 last:border-b-0"
            key={header}
          >
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-slate-100 text-[11px] font-semibold text-slate-700">
              {index + 1}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-900">
              {header}
            </span>
            {index === 0 ? <KeyRound className="h-3.5 w-3.5 text-slate-500" /> : null}
          </div>
        ))}

        {!displayedHeaders.length ? (
          <div className="min-h-9 px-3 py-2 text-[12px] font-semibold text-slate-500">
            No headers detected
          </div>
        ) : null}
      </div>

      <button
        className="mt-3 h-10 w-full rounded-lg border border-slate-200 bg-white text-[12px] font-bold text-blue-700 shadow-sm transition hover:bg-blue-50"
        type="button"
      >
        View All {headerCount} Headers
      </button>
    </section>
  );
}
