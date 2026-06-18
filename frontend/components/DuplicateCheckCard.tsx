import { AlertTriangle, CheckCircle2, ShieldAlert, ShieldCheck } from "lucide-react";
import type { DuplicateCheckResult } from "@/types/facility";
import type { SheetRow } from "@/types/sheet";

type DuplicateCheckCardProps = {
  duplicateResult?: DuplicateCheckResult | null;
  isChecking?: boolean;
};

export function DuplicateCheckCard({ duplicateResult = null, isChecking = false }: DuplicateCheckCardProps) {
  const status = duplicateResult?.status ?? "no_duplicate";
  const matchCount = duplicateResult?.matches.length ?? 0;
  const hasDuplicate = status !== "no_duplicate";
  const badgeClass = hasDuplicate ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-800";
  const Icon = hasDuplicate ? AlertTriangle : CheckCircle2;
  const ShieldIcon = hasDuplicate ? ShieldAlert : ShieldCheck;
  const badgeText = isChecking
    ? "Checking..."
    : status === "exact_duplicate"
      ? "Exact Duplicate Found"
      : status === "possible_duplicate"
        ? "Possible Duplicate"
        : "No Duplicates Found";
  const message = isChecking
    ? "Checking existing records in the active category."
    : hasDuplicate
      ? `${matchCount} possible matching record${matchCount === 1 ? "" : "s"} found. Review before saving.`
      : "This facility does not exist in the selected category.";
  const topMatches = duplicateResult?.matches.slice(0, 2) ?? [];

  function valueFor(row: SheetRow, fields: string[]) {
    for (const field of fields) {
      const value = row[field];
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }

    return "";
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-slate-950">Duplicate Check</h2>
        <span className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-bold ${badgeClass}`}>
          <Icon className="h-3.5 w-3.5" />
          {badgeText}
        </span>
      </div>
      <div className="flex items-center gap-5 py-3">
        <span
          className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${
            hasDuplicate ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"
          }`}
        >
          <ShieldIcon className="h-10 w-10 stroke-[1.6]" />
        </span>
        <p className="text-[13px] leading-6 text-slate-900">
          We checked existing records.
          <br />
          {message}
        </p>
      </div>

      {topMatches.length ? (
        <div className="mt-3 space-y-2">
          {topMatches.map((match) => {
            const facilityName = valueFor(match.row, ["Facility Name", "FACILITY NAME", "Name"]);
            const hefNo = valueFor(match.row, ["HEF/NO", "HEF NO", "REG NO"]);

            return (
              <div className="rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2" key={match.rowIndex}>
                <div className="flex items-center justify-between gap-3">
                  <p className="truncate text-[12px] font-bold text-slate-950">
                    {facilityName || hefNo || `Row ${match.rowIndex + 2}`}
                  </p>
                  <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100">
                    {Math.round(match.score * 100)}%
                  </span>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-slate-600">
                  Row {match.rowIndex + 2}
                  {hefNo ? ` - ${hefNo}` : ""}
                </p>
                {match.reasons.length ? (
                  <p className="mt-1 text-[11px] text-slate-500">{match.reasons.join(", ")}</p>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
