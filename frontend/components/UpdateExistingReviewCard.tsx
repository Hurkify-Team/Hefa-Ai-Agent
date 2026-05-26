"use client";

import { CheckCircle2, Circle, Loader2, RefreshCw } from "lucide-react";

import type { DuplicateMatch } from "@/types/facility";
import type { SheetRow } from "@/types/sheet";

type UpdateExistingReviewCardProps = {
  headers: string[];
  matchedFields: SheetRow;
  matches: DuplicateMatch[];
  selectedRowIndex: number | null;
  selectedFields: Set<string>;
  isUpdating?: boolean;
  onSelectField: (field: string) => void;
  onSelectMatch: (rowIndex: number) => void;
  onSelectBlankFields: () => void;
  onSelectChangedFields: () => void;
  onClearFields: () => void;
  onUpdate: () => void;
};

function isBlank(value: SheetRow[string] | undefined) {
  return value === null || value === undefined || String(value).trim() === "";
}

function valueText(value: SheetRow[string] | undefined) {
  return isBlank(value) ? "-" : String(value);
}

function sameValue(left: SheetRow[string] | undefined, right: SheetRow[string] | undefined) {
  return String(left ?? "").trim().toLowerCase() === String(right ?? "").trim().toLowerCase();
}

function facilityName(row: SheetRow) {
  const value = row["Facility Name"] ?? row["FACILITY NAME"] ?? row.Name ?? row["Name of Facility"];
  return isBlank(value) ? "Unnamed Facility" : String(value);
}

function hefNo(row: SheetRow) {
  const value = row["HEF/NO"] ?? row["HEF NO"] ?? row["REG NO"] ?? row["Registration Number"];
  return isBlank(value) ? "No HEF/NO" : String(value);
}

function rowDetails(row: SheetRow) {
  return Object.entries(row).filter(([, value]) => !isBlank(value));
}

function fieldStatus(existingValue: SheetRow[string] | undefined, extractedValue: SheetRow[string] | undefined) {
  if (isBlank(extractedValue)) {
    return { label: "No extracted value", className: "bg-slate-100 text-slate-600", canSelect: false };
  }

  if (sameValue(existingValue, extractedValue)) {
    return { label: "Same", className: "bg-emerald-100 text-emerald-700", canSelect: false };
  }

  if (isBlank(existingValue)) {
    return { label: "Fill blank", className: "bg-blue-100 text-blue-700", canSelect: true };
  }

  return { label: "Changed", className: "bg-amber-100 text-amber-800", canSelect: true };
}

export function UpdateExistingReviewCard({
  headers,
  matchedFields,
  matches,
  selectedRowIndex,
  selectedFields,
  isUpdating = false,
  onSelectField,
  onSelectMatch,
  onSelectBlankFields,
  onSelectChangedFields,
  onClearFields,
  onUpdate,
}: UpdateExistingReviewCardProps) {
  const selectedMatch = matches.find((match) => match.rowIndex === selectedRowIndex) ?? matches[0] ?? null;
  const selectedCount = selectedFields.size;

  if (!selectedMatch) {
    return null;
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[17px] font-extrabold text-slate-950">Update Existing Facility Review</h2>
          <p className="mt-1 text-[13px] font-semibold text-slate-600">
            Choose the existing row, compare every active sheet header, then update only confirmed fields.
          </p>
        </div>
        <button
          className="flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-[13px] font-bold text-white shadow-sm disabled:cursor-not-allowed disabled:bg-slate-300"
          disabled={isUpdating || selectedCount === 0}
          onClick={onUpdate}
          type="button"
        >
          {isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {isUpdating ? "Updating..." : "Update " + selectedCount + " Field" + (selectedCount === 1 ? "" : "s")}
        </button>
      </div>

      <div className="mt-4 grid gap-3 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="text-[12px] font-extrabold uppercase tracking-[0.03em] text-slate-500">Duplicate Matches</h3>
            <div className="mt-3 space-y-2">
              {matches.map((match) => {
                const selected = match.rowIndex === selectedMatch.rowIndex;

                return (
                  <button
                    className={
                      "w-full rounded-lg border px-3 py-2 text-left transition " +
                      (selected ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-white hover:bg-slate-50")
                    }
                    key={match.rowIndex}
                    onClick={() => onSelectMatch(match.rowIndex)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-extrabold text-slate-950">
                          {facilityName(match.row)}
                        </span>
                        <span className="mt-1 block text-[11px] font-semibold text-slate-500">
                          Row {match.rowIndex + 2} - {hefNo(match.row)}
                        </span>
                      </span>
                      <span className="rounded-full bg-white px-2 py-1 text-[10px] font-extrabold text-amber-700 ring-1 ring-amber-100">
                        {Math.round(match.score * 100)}%
                      </span>
                    </div>
                    {match.reasons.length ? (
                      <p className="mt-1 line-clamp-2 text-[11px] font-semibold text-slate-500">
                        {match.reasons.join(", ")}
                      </p>
                    ) : null}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="text-[12px] font-extrabold uppercase tracking-[0.03em] text-slate-500">Existing Row Full Details</h3>
            <div className="mt-3 max-h-[380px] space-y-2 overflow-auto pr-1">
              {rowDetails(selectedMatch.row).map(([header, value]) => (
                <div className="rounded-md bg-slate-50 px-3 py-2" key={header}>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.03em] text-slate-400">{header}</p>
                  <p className="mt-1 break-words text-[12px] font-semibold text-slate-800">{valueText(value)}</p>
                </div>
              ))}
            </div>
          </div>
        </aside>

        <div className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-3">
            <h3 className="text-[12px] font-extrabold uppercase tracking-[0.03em] text-slate-500">Field Comparison</h3>
            <div className="flex flex-wrap gap-2">
              <button className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700" onClick={onSelectBlankFields} type="button">
                Blank Only
              </button>
              <button className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700" onClick={onSelectChangedFields} type="button">
                All Changed
              </button>
              <button className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-700" onClick={onClearFields} type="button">
                Clear
              </button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-[780px] w-full border-collapse text-left">
              <thead className="bg-white">
                <tr>
                  <th className="w-[42px] border-b border-slate-200 px-3 py-2" />
                  <th className="border-b border-slate-200 px-3 py-2 text-[11px] font-extrabold text-slate-950">Sheet Header</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-[11px] font-extrabold text-slate-950">Existing Value</th>
                  <th className="border-b border-slate-200 px-3 py-2 text-[11px] font-extrabold text-slate-950">Extracted Value</th>
                  <th className="w-[116px] border-b border-slate-200 px-3 py-2 text-[11px] font-extrabold text-slate-950">Status</th>
                </tr>
              </thead>
              <tbody>
                {headers.map((header) => {
                  const existingValue = selectedMatch.row[header];
                  const extractedValue = matchedFields[header];
                  const status = fieldStatus(existingValue, extractedValue);
                  const checked = selectedFields.has(header);

                  return (
                    <tr className="border-b border-slate-100 last:border-b-0" key={header}>
                      <td className="px-3 py-2 align-top">
                        <button
                          className="mt-0.5 text-slate-400 disabled:cursor-not-allowed disabled:opacity-40"
                          disabled={!status.canSelect}
                          onClick={() => onSelectField(header)}
                          type="button"
                        >
                          {checked ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="px-3 py-2 align-top text-[12px] font-extrabold text-slate-950">{header}</td>
                      <td className="max-w-[220px] px-3 py-2 align-top text-[12px] leading-4 text-slate-700">
                        {valueText(existingValue)}
                      </td>
                      <td className="max-w-[220px] px-3 py-2 align-top text-[12px] leading-4 text-slate-900">
                        {valueText(extractedValue)}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className={"inline-flex rounded-full px-2 py-1 text-[10px] font-extrabold " + status.className}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
