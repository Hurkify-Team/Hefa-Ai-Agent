"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Database, MinusCircle, Pencil, Save, RefreshCw, XCircle } from "lucide-react";
import type { SheetRow, SheetRowValue } from "@/types/sheet";

const statusIcons = {
  success: <CheckCircle2 className="h-4 w-4 fill-blue-600 text-white" />,
  neutral: <MinusCircle className="h-4 w-4 fill-slate-300 text-white" />,
  warning: <AlertTriangle className="h-4 w-4 fill-amber-500 text-white" />,
};

type PreparedSavePreview = {
  category: string;
  row: SheetRow;
  autoSerial: {
    header: string;
    value: number;
  } | null;
};

type LegacyFieldSuggestion = {
  header: string;
  activeValue: SheetRowValue | null;
  oldValue: SheetRowValue | null;
  status: "fill_from_old" | "conflict" | "same" | "empty";
};

type LegacyFallbackResolution = {
  configured: boolean;
  sourceLabel: string;
  match: {
    category: string;
    rowIndex: number;
    facilityName: string;
    hefNo: string;
  } | null;
  suggestions: LegacyFieldSuggestion[];
  fillableCount: number;
  conflictCount: number;
  sameCount: number;
  note: string;
};

type PreviewDataCardProps = {
  confidence?: number;
  headers?: string[];
  isSaving?: boolean;
  isUpdating?: boolean;
  matchedFields?: SheetRow | null;
  missingFields?: string[];
  onSave?: () => void;
  onUpdate?: () => void;
  onCancel?: () => void;
  onValueChange?: (header: string, value: string) => void;
  onRecheckDuplicate?: () => void;
  isCheckingDuplicate?: boolean;
  requiresDuplicateRecheck?: boolean;
  saveDisabled?: boolean;
  preparedSavePreview?: PreparedSavePreview | null;
  legacyResolution?: LegacyFallbackResolution | null;
  isResolvingLegacy?: boolean;
  onApplyLegacySuggestions?: () => void;
  saveMessage?: string | null;
  saveLabel?: string;
  updateDisabled?: boolean;
  updateLabel?: string;
};

function formatValue(value: SheetRow[string] | undefined) {
  if (value == null || value === "") {
    return "-";
  }

  return String(value);
}

export function PreviewDataCard({
  confidence,
  headers,
  isSaving = false,
  isUpdating = false,
  matchedFields = null,
  missingFields,
  onSave,
  onUpdate,
  onCancel,
  onValueChange,
  onRecheckDuplicate,
  isCheckingDuplicate = false,
  requiresDuplicateRecheck = false,
  saveDisabled = false,
  preparedSavePreview = null,
  legacyResolution = null,
  isResolvingLegacy = false,
  onApplyLegacySuggestions,
  saveLabel = "Save to Sheet",
  saveMessage = null,
  updateDisabled = true,
  updateLabel = "Update Existing",
}: PreviewDataCardProps) {
  const [isEditing, setIsEditing] = useState(false);
  const dynamicRows = (headers ?? []).map((header) => {
    const value = matchedFields?.[header];
    const isMissing = value == null || value === "";

    return {
      header,
      value: matchedFields ? formatValue(value) : "-",
      status: matchedFields ? (isMissing ? "warning" : "success") : "neutral",
    };
  });
  const activeMissingFields = matchedFields
    ? missingFields ?? dynamicRows.filter((row) => row.status === "warning").map((row) => row.header)
    : [];
  const confidencePercent = confidence == null ? null : Math.round(confidence * 100);
  const legacyFillableSuggestions = legacyResolution?.suggestions.filter((suggestion) => suggestion.status === "fill_from_old") ?? [];
  const legacyConflicts = legacyResolution?.suggestions.filter((suggestion) => suggestion.status === "conflict") ?? [];
  const preparedEntries = preparedSavePreview
    ? Object.entries(preparedSavePreview.row).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    : [];

  function fieldValue(header: string) {
    const value = matchedFields?.[header];
    return value === null || value === undefined ? "" : String(value);
  }

  function isLongField(header: string, value: string) {
    const normalized = header.toLowerCase();
    return value.length > 48 || normalized.includes("address") || normalized.includes("scope") || normalized.includes("service");
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <h2 className="text-[17px] font-bold tracking-[-0.01em] text-slate-950">
          3. Preview Extracted Data
        </h2>
        <span className="flex shrink-0 items-center gap-1.5 rounded-md bg-blue-100 px-3 py-1.5 text-[12px] font-bold text-blue-800">
          <CheckCircle2 className="h-3.5 w-3.5" />
          {confidencePercent == null ? "Awaiting Capture" : "AI Confidence: " + confidencePercent + "%"}
        </span>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full border-collapse text-left">
          <thead className="bg-slate-50">
            <tr>
              <th className="border-b border-slate-200 px-3 py-2 text-[11px] font-extrabold text-slate-950">
                Sheet Header
              </th>
              <th className="border-b border-slate-200 px-3 py-2 text-[11px] font-extrabold text-slate-950">
                Extracted Value
              </th>
              <th className="w-[54px] border-b border-slate-200 px-3 py-2 text-center text-[11px] font-extrabold text-slate-950">
                Status
              </th>
            </tr>
          </thead>
          <tbody>
            {dynamicRows.length ? dynamicRows.map((row) => (
              <tr className="border-b border-slate-200 last:border-b-0" key={row.header}>
                <td className="px-3 py-[8px] align-top text-[12px] font-bold text-slate-950">
                  {row.header}
                </td>
                <td className="max-w-[168px] px-3 py-[8px] align-top text-[12px] leading-4 text-slate-900">
                  {isEditing && matchedFields && onValueChange ? (
                    isLongField(row.header, fieldValue(row.header)) ? (
                      <textarea
                        className="min-h-[64px] w-full resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-[12px] font-semibold leading-4 text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        onChange={(event) => onValueChange(row.header, event.target.value)}
                        value={fieldValue(row.header)}
                      />
                    ) : (
                      <input
                        className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-[12px] font-semibold text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                        onChange={(event) => onValueChange(row.header, event.target.value)}
                        value={fieldValue(row.header)}
                      />
                    )
                  ) : (
                    row.value
                  )}
                </td>
                <td className="px-3 py-[8px] text-center align-top">
                  <span className="inline-flex h-5 w-5 items-center justify-center">
                    {statusIcons[row.status as keyof typeof statusIcons]}
                  </span>
                </td>
              </tr>
            )) : (
              <tr>
                <td className="px-3 py-8 text-center text-[12px] font-semibold text-slate-500" colSpan={3}>
                  Select a category and capture a portal page to preview extracted data.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
        <h3 className="text-[12px] font-extrabold text-slate-950">
          Missing Fields ({activeMissingFields.length})
        </h3>
        <ul className="mt-2 space-y-1 text-[11px] text-slate-800">
          {matchedFields && activeMissingFields.length ? (
            activeMissingFields.map((field) => (
              <li className="flex items-center gap-2" key={field}>
                <span className="h-1 w-1 rounded-full bg-slate-700" />
                {field}
              </li>
            ))
          ) : (
            <li className="flex items-center gap-2">
              <span className="h-1 w-1 rounded-full bg-slate-700" />
              {matchedFields ? "No missing fields detected" : "No capture has been mapped yet"}
            </li>
          )}
        </ul>
      </div>

      {isResolvingLegacy || legacyResolution ? (
        <div className="mt-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="flex items-center gap-2 text-[12px] font-extrabold text-slate-950">
                <Database className="h-4 w-4 text-blue-600" />
                Old Database Fallback
              </h3>
              <p className="mt-1 text-[11px] font-semibold leading-5 text-blue-900">
                {isResolvingLegacy ? "Checking Old Hefamaa Database for missing values..." : legacyResolution?.note}
              </p>
              {legacyResolution?.match ? (
                <p className="mt-1 text-[11px] font-semibold text-slate-600">
                  Matched {legacyResolution.match.facilityName || legacyResolution.match.hefNo || "legacy record"} in {legacyResolution.match.category} row {legacyResolution.match.rowIndex + 2}.
                </p>
              ) : null}
            </div>
            {legacyResolution?.configured === false ? (
              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-extrabold text-slate-600 ring-1 ring-slate-200">
                Not configured
              </span>
            ) : legacyResolution ? (
              <span className="rounded-full bg-white px-3 py-1 text-[11px] font-extrabold text-blue-700 ring-1 ring-blue-100">
                {legacyResolution.fillableCount} fillable / {legacyResolution.conflictCount} conflict
              </span>
            ) : null}
          </div>

          {legacyFillableSuggestions.length ? (
            <div className="mt-3 space-y-2">
              {legacyFillableSuggestions.slice(0, 5).map((suggestion) => (
                <div className="rounded-md bg-white px-3 py-2 ring-1 ring-blue-100" key={suggestion.header}>
                  <p className="text-[10px] font-extrabold uppercase tracking-[0.03em] text-slate-500">{suggestion.header}</p>
                  <p className="mt-1 break-words text-[12px] font-semibold text-slate-900">{formatValue(suggestion.oldValue ?? null)}</p>
                </div>
              ))}
              {legacyFillableSuggestions.length > 5 ? (
                <p className="text-[11px] font-semibold text-blue-800">
                  Showing first 5 of {legacyFillableSuggestions.length} old-database fallback values.
                </p>
              ) : null}
              <button
                className="mt-1 h-9 rounded-lg bg-blue-600 px-3 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={!onApplyLegacySuggestions || !matchedFields || isSaving || isUpdating}
                onClick={onApplyLegacySuggestions}
                type="button"
              >
                Apply Missing Values from Old DB
              </button>
            </div>
          ) : null}

          {legacyConflicts.length ? (
            <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-[11px] font-extrabold text-amber-900">Conflicts kept for manual review</p>
              <ul className="mt-2 space-y-1 text-[11px] font-semibold text-amber-900">
                {legacyConflicts.slice(0, 4).map((suggestion) => (
                  <li key={suggestion.header}>
                    {suggestion.header}: active/portal "{formatValue(suggestion.activeValue ?? null)}" vs old "{formatValue(suggestion.oldValue ?? null)}"
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {preparedSavePreview ? (
        <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-[12px] font-extrabold text-slate-950">Prepared Google Sheet Row</h3>
              <p className="mt-1 text-[11px] font-semibold text-blue-800">
                Review this prepared {preparedSavePreview.category} row before confirming the live write.
              </p>
            </div>
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-extrabold text-blue-700 ring-1 ring-blue-200">
              {preparedSavePreview.autoSerial
                ? preparedSavePreview.autoSerial.header + ": " + preparedSavePreview.autoSerial.value
                : "No S/N column"}
            </span>
          </div>
          {preparedEntries.length ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {preparedEntries.slice(0, 8).map(([field, value]) => (
                <div className="rounded-md bg-white px-3 py-2 ring-1 ring-blue-100" key={field}>
                  <p className="truncate text-[10px] font-extrabold uppercase tracking-[0.03em] text-slate-500">{field}</p>
                  <p className="mt-1 break-words text-[12px] font-semibold text-slate-900">{formatValue(value)}</p>
                </div>
              ))}
            </div>
          ) : null}
          {preparedEntries.length > 8 ? (
            <p className="mt-2 text-[11px] font-semibold text-blue-800">
              Showing first 8 filled fields of {preparedEntries.length}. The full row will follow the selected sheet headers.
            </p>
          ) : null}
        </div>
      ) : null}

      {requiresDuplicateRecheck ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] font-bold text-amber-900">
              Extracted values changed. Recheck duplicates before saving or updating.
            </p>
            <button
              className="flex h-9 items-center justify-center gap-2 rounded-lg bg-amber-600 px-3 text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={isCheckingDuplicate || !matchedFields}
              onClick={onRecheckDuplicate}
              type="button"
            >
              <RefreshCw className={`h-4 w-4 ${isCheckingDuplicate ? "animate-spin" : ""}`} />
              {isCheckingDuplicate ? "Checking..." : "Recheck Duplicate"}
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 min-[480px]:grid-cols-3">
        <button
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-[12px] font-bold text-slate-900 shadow-sm transition hover:bg-slate-50"
          disabled={!matchedFields || !onValueChange}
          onClick={() => setIsEditing((current) => !current)}
          type="button"
        >
          <Pencil className="h-4 w-4" />
          {isEditing ? "Done Editing" : "Edit Extracted Data"}
        </button>
        <button
          className="flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-100 bg-rose-50 text-[12px] font-bold text-rose-700 shadow-sm transition hover:bg-rose-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
          disabled={!matchedFields || isSaving || isUpdating}
          onClick={onCancel}
          type="button"
        >
          <XCircle className="h-4 w-4" />
          Cancel
        </button>
        <button
          className="flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 text-[12px] font-bold text-white shadow-[0_12px_25px_rgba(37,99,235,0.26)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          disabled={saveDisabled || isSaving || isUpdating || !matchedFields}
          onClick={onSave}
          type="button"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : saveLabel}
        </button>
      </div>

      {onUpdate ? (
        <button
          className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 text-[12px] font-bold text-blue-800 transition hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
          disabled={updateDisabled || isSaving || isUpdating || !matchedFields}
          onClick={onUpdate}
          type="button"
        >
          <RefreshCw className={`h-4 w-4 ${isUpdating ? "animate-spin" : ""}`} />
          {isUpdating ? "Updating..." : updateLabel}
        </button>
      ) : null}

      {saveMessage ? (
        <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-700">
          {saveMessage}
        </p>
      ) : null}
    </section>
  );
}
