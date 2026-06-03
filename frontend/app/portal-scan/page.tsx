"use client";

import { useEffect, useState } from "react";
import { ExternalLink, FileSpreadsheet, FileText, RefreshCw, Search, Table, Zap } from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type PortalFacilitySummary = {
  totalFacilities: number;
  totalPortalRecords: number;
  portalReportedRecords: number | null;
  categoryCounts: Array<{ category: string; count: number }>;
  categoryPortalRecordCounts: Array<{ category: string; count: number }>;
  applicationTypeCounts: Record<"new_registration" | "renewal" | "unknown", number>;
  facilityTypeCounts: Record<"new_registration" | "existing_facility" | "unknown", number>;
  statusCounts: Record<string, number>;
  scanProgress: {
    completedAt: string | null;
    error?: string;
    portalReportedRecords: number | null;
    scannedPages: number;
    scannedRecords: number;
    startedAt: string | null;
    status: "idle" | "running" | "completed" | "failed";
  };
  lastScanned: string | null;
  monthlyRegistrationCounts: Array<{ month: string; count: number }>;
  monthlyNewRegistrationCounts: Array<{ month: string; count: number }>;
  monthlyRenewalCounts: Array<{ month: string; count: number }>;
  yearlyPortalRecordCounts: Array<{ year: number; count: number }>;
  yearlyRenewalCounts: Array<{ year: number; count: number }>;
  note?: string;
};

type PortalStatusResult = {
  status: string;
  url: string | null;
  note: string;
  persistentProfile: boolean;
  profileLocked?: boolean;
  profileLockPid?: number;
  profileName: string;
};

type PortalCachedRecord = {
  facilityName: string;
  hefamaaId: string;
  category: string;
  registrationStatus: string;
  renewalYear: number | null;
  applicationType: "new_registration" | "renewal" | "unknown";
  normalizedStatus: string;
  visibleFields?: Record<string, string>;
};

type PortalRecordsResult = {
  cachedFacilities: number;
  matchCount: number;
  records: PortalCachedRecord[];
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-NG").format(value);
}

const workflowStatusLabels: Record<string, string> = {
  document_queried: "Document queried",
  payment_queried: "Payment queried",
  upload_payment_pending_document_approval: "Upload payment and pending document approval",
  payment_approved_pending_document_approval: "Payment approved and pending document approval",
  document_approved_inspection_pending: "Document approved and inspection reporting pending",
  inspection_report_upload_pending_approval: "Inspection report upload pending approval",
  final_approval_pending: "Final approval pending",
  registration_approved: "Registration approved",
  waiting_to_onboard: "Waiting to onboard",
  unknown_status: "Other or unrecognised status",
};

function statusLabel(status: string) {
  return workflowStatusLabels[status] ?? status.replace(/_/g, " ");
}

export default function PortalScanPage() {
  const [status, setStatus] = useState<PortalStatusResult | null>(null);
  const [summary, setSummary] = useState<PortalFacilitySummary | null>(null);
  const [message, setMessage] = useState("Loading portal scan status...");
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [cacheQuery, setCacheQuery] = useState("");
  const [cachedRecords, setCachedRecords] = useState<PortalRecordsResult | null>(null);
  const [isSearchingCache, setIsSearchingCache] = useState(false);

  const isFullScanRunning = summary?.scanProgress.status === "running";

  useEffect(() => {
    void loadStatusAndSummary();
  }, []);

  useEffect(() => {
    if (!isFullScanRunning) return;

    const pollSummary = async () => {
      try {
        const nextSummary = await fetchApi<PortalFacilitySummary>("/api/portal/summary");
        setSummary(nextSummary);
        if (nextSummary.scanProgress.status === "completed") {
          setMessage("Portal scan completed. The local facility index and analytics are ready.");
        } else if (nextSummary.scanProgress.status === "failed") {
          setMessage(nextSummary.scanProgress.error ?? "Portal scan failed.");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to refresh portal scan progress.");
      }
    };

    const timer = window.setInterval(() => void pollSummary(), 2_000);
    return () => window.clearInterval(timer);
  }, [isFullScanRunning]);

  async function loadStatusAndSummary() {
    setIsLoading(true);
    setMessage("Loading portal status and summary...");

    try {
      const [nextStatus, nextSummary] = await Promise.all([
        fetchApi<PortalStatusResult>("/api/portal/status"),
        fetchApi<PortalFacilitySummary>("/api/portal/summary"),
      ]);
      setStatus(nextStatus);
      setSummary(nextSummary);
      setMessage(nextSummary.note ?? "Portal scan summary loaded.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load portal scan data.");
    } finally {
      setIsLoading(false);
    }
  }

  async function openPortal() {
    setIsOpening(true);
    setMessage("Opening portal... please wait.");

    try {
      const nextStatus = await fetchApi<PortalStatusResult>("/api/portal/open", {
        method: "POST",
      });
      setStatus(nextStatus);
      setMessage(nextStatus.note ?? "Portal opened. You can now run a full scan.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open portal.");
    } finally {
      setIsOpening(false);
    }
  }

  async function scanPortal() {
    setIsScanning(true);
    setMessage("Scanning portal facility list. This may take a few moments...");

    try {
      const nextSummary = await fetchApi<PortalFacilitySummary>("/api/portal/scan", {
        method: "POST",
      });
      setSummary(nextSummary);
      setMessage("Portal scan started in the background. Progress will update automatically.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to scan portal.");
    } finally {
      setIsScanning(false);
    }
  }

  async function searchCachedFacilities() {
    setIsSearchingCache(true);

    try {
      const query = cacheQuery.trim();
      const result = await fetchApi<PortalRecordsResult>(
        "/api/portal/records?limit=25" + (query ? "&query=" + encodeURIComponent(query) : ""),
      );
      setCachedRecords(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to search the local portal index.");
    } finally {
      setIsSearchingCache(false);
    }
  }

  return (
    <AppShell>
      <section className="space-y-6 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              Portal Scan & Workflow Monitor
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Scan the HEFAMAA portal for all facilities, persist the result cache, and review workflow status counts.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              className="flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isOpening || isLoading}
              onClick={() => void openPortal()}
              type="button"
            >
              <ExternalLink className="h-4 w-4" />
              {isOpening ? "Opening Portal..." : "Open Portal"}
            </button>
            <button
              className="flex h-11 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 text-[13px] font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isScanning || isLoading || isFullScanRunning}
              onClick={() => void scanPortal()}
              type="button"
            >
              <Search className="h-4 w-4" />
              {isScanning || isFullScanRunning ? "Scanning..." : "Run Full Scan"}
            </button>
            <a
              className="flex h-11 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-[13px] font-bold text-blue-700 shadow-sm transition hover:bg-blue-100"
              href="/api/portal/export/excel"
            >
              <FileSpreadsheet className="h-4 w-4" />
              Export Excel
            </a>
            <a
              className="flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-50"
              href="/api/portal/export/pdf"
            >
              <FileText className="h-4 w-4" />
              Export PDF
            </a>
            <button
              className="flex h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={isLoading}
              onClick={() => void loadStatusAndSummary()}
              type="button"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh Summary
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Portal Scan Status
                  </p>
                  <p className="mt-2 text-[15px] text-slate-700">{message}</p>
                </div>
                <div className="rounded-full bg-slate-100 px-3 py-1 text-[12px] font-semibold text-slate-700">
                  {status?.status ?? "Unknown"}
                </div>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Portal URL
                  </p>
                  <p className="mt-2 text-[14px] font-semibold text-slate-950">{status?.url ?? "Not connected"}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Session
                  </p>
                  <p className="mt-2 text-[14px] font-semibold text-slate-950">
                    {status?.persistentProfile ? "Persistent" : "Temporary"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Profile Lock
                  </p>
                  <p className="mt-2 text-[14px] font-semibold text-slate-950">
                    {status?.profileLocked ? `Locked${status.profileLockPid ? ` (${status.profileLockPid})` : ""}` : "Unlocked"}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-emerald-600" />
                <h2 className="text-[17px] font-bold text-slate-950">
                  Scan Summary
                </h2>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Portal-reported rows</p>
                  <p className="mt-2 text-[24px] font-extrabold text-slate-950">{summary?.portalReportedRecords ? formatCount(summary.portalReportedRecords) : "-"}</p>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-blue-700">Indexed portal rows</p>
                  <p className="mt-2 text-[24px] font-extrabold text-blue-900">{summary ? formatCount(summary.totalPortalRecords) : "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Distinct facilities</p>
                  <p className="mt-2 text-[24px] font-extrabold text-slate-950">{summary ? formatCount(summary.totalFacilities) : "-"}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-emerald-700">New registrations</p>
                  <p className="mt-2 text-[24px] font-extrabold text-emerald-900">{summary ? formatCount(summary.facilityTypeCounts.new_registration) : "-"}</p>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-indigo-700">Existing facilities</p>
                  <p className="mt-2 text-[24px] font-extrabold text-indigo-900">{summary ? formatCount(summary.facilityTypeCounts.existing_facility) : "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Last scanned</p>
                  <p className="mt-2 text-[12px] font-semibold text-slate-950">{summary?.lastScanned ?? "Never"}</p>
                </div>
              </div>
              {summary?.scanProgress.status === "running" ? (
                <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center justify-between gap-3 text-[13px] font-semibold text-emerald-900">
                    <span>Full portal scan in progress</span>
                    <span>{formatCount(summary.scanProgress.scannedRecords)} rows across {formatCount(summary.scanProgress.scannedPages)} pages</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100">
                    <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: Math.min(100, summary.scanProgress.portalReportedRecords ? summary.scanProgress.scannedRecords / summary.scanProgress.portalReportedRecords * 100 : 4) + "%" }} />
                  </div>
                </div>
              ) : null}
              {summary ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {Object.entries(summary.statusCounts).map(([statusKey, count]) => (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4" key={statusKey}>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {statusLabel(statusKey)}
                      </p>
                      <p className="mt-2 text-[20px] font-semibold text-slate-950">{formatCount(count)}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <Table className="h-5 w-5 text-blue-700" />
                <h2 className="text-[17px] font-bold text-slate-950">Search Local Portal Index</h2>
              </div>
              <p className="mt-2 text-[13px] text-slate-600">
                Search facilities captured by the most recent read-only portal scan.
              </p>
              <form
                className="mt-4 flex gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  void searchCachedFacilities();
                }}
              >
                <input
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  onChange={(event) => setCacheQuery(event.target.value)}
                  placeholder="Facility name, HEF number, category, or status"
                  value={cacheQuery}
                />
                <button
                  className="flex h-10 items-center gap-2 rounded-lg bg-emerald-600 px-4 text-[13px] font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
                  disabled={isSearchingCache}
                  type="submit"
                >
                  <Search className="h-4 w-4" />
                  {isSearchingCache ? "Searching..." : "Search"}
                </button>
              </form>
              {cachedRecords ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <a
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-[12px] font-bold text-blue-700 hover:bg-blue-100"
                    href={"/api/portal/export/excel" + (cacheQuery.trim() ? "?query=" + encodeURIComponent(cacheQuery.trim()) : "")}
                  >
                    <FileSpreadsheet className="h-4 w-4" />
                    Export Search Excel
                  </a>
                  <a
                    className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-bold text-slate-700 hover:bg-slate-50"
                    href={"/api/portal/export/pdf" + (cacheQuery.trim() ? "?query=" + encodeURIComponent(cacheQuery.trim()) : "")}
                  >
                    <FileText className="h-4 w-4" />
                    Export Search PDF
                  </a>
                </div>
              ) : null}
              {cachedRecords ? (
                <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                  <div className="bg-slate-50 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                    {formatCount(cachedRecords.matchCount)} match{cachedRecords.matchCount === 1 ? "" : "es"} from {formatCount(cachedRecords.cachedFacilities)} cached facilities
                  </div>
                  <div className="max-h-80 divide-y divide-slate-200 overflow-auto">
                    {cachedRecords.records.map((record, index) => (
                      <details className="px-3 py-3 text-[12px]" key={record.hefamaaId + record.facilityName + index}>
                        <summary className="grid cursor-pointer gap-1 sm:grid-cols-[1.2fr_0.8fr]">
                          <span className="min-w-0">
                            <span className="block truncate font-bold text-slate-950">{record.facilityName || "Unnamed facility"}</span>
                            <span className="mt-1 block truncate font-semibold text-blue-700">{record.hefamaaId || "No HEF number visible"}</span>
                          </span>
                          <span className="min-w-0 text-slate-600">
                            <span className="block truncate font-semibold">{record.category || "Uncategorised"}</span>
                            <span className="mt-1 block truncate">{record.registrationStatus || "Status not visible"} {record.renewalYear ? `- ${record.renewalYear}` : ""}</span>
                          </span>
                        </summary>
                        <dl className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
                          {Object.entries(record.visibleFields ?? {}).map(([label, value]) => (
                            <div key={label}>
                              <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500">{label}</dt>
                              <dd className="mt-1 text-slate-800">{value || "-"}</dd>
                            </div>
                          ))}
                        </dl>
                      </details>
                    ))}
                    {!cachedRecords.records.length ? (
                      <p className="px-3 py-5 text-[13px] text-slate-500">No cached facility matches this search.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-[17px] font-bold text-slate-950">Workflow Analytics</h2>
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Monthly new registrations</p>
                  {summary?.monthlyNewRegistrationCounts.length ? (
                    <ul className="mt-3 space-y-2 text-[13px] text-slate-700">
                      {summary.monthlyNewRegistrationCounts.slice(-6).map((entry) => (
                        <li key={entry.month} className="flex items-center justify-between gap-3">
                          <span>{entry.month}</span>
                          <span className="font-semibold text-slate-950">{formatCount(entry.count)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[13px] text-slate-500">No dated new-registration rows were detected.</p>
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Portal records by renewal year</p>
                  {summary?.yearlyPortalRecordCounts.length ? (
                    <ul className="mt-3 space-y-2 text-[13px] text-slate-700">
                      {summary.yearlyPortalRecordCounts.map((entry) => (
                        <li key={entry.year} className="flex items-center justify-between gap-3">
                          <span>{entry.year}</span>
                          <span className="font-semibold text-slate-950">{formatCount(entry.count)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[13px] text-slate-500">No renewal summary data available.</p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-[17px] font-bold text-slate-950">Facility Categories</h2>
              {summary?.categoryCounts.length ? (
                <ul className="mt-4 max-h-72 space-y-2 overflow-auto pr-1 text-[13px] text-slate-700">
                  {summary.categoryCounts.map((entry) => (
                    <li className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2" key={entry.category}>
                      <span className="truncate font-semibold">{entry.category}</span>
                      <span className="font-bold text-slate-950">{formatCount(entry.count)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-[13px] text-slate-500">No category counts available until a portal scan completes.</p>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-[17px] font-bold text-slate-950">Portal Notes</h2>
              <p className="mt-3 text-[14px] leading-6 text-slate-700">
                The scan reads only portal pages visible to your logged-in HEFAMAA account and stores a local read-only index. It does not write to Google Sheets. Portal-reported rows include yearly renewal records, while distinct facilities groups those records by facility and category. Excel and PDF exports contain the key information visible in the facility list.
              </p>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
