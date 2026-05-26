"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Search, ShieldCheck, Table, Zap } from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type PortalFacilitySummary = {
  totalFacilities: number;
  statusCounts: Record<string, number>;
  lastScanned: string | null;
  monthlyRegistrationCounts: Array<{ month: string; count: number }>;
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

export default function PortalScanPage() {
  const [status, setStatus] = useState<PortalStatusResult | null>(null);
  const [summary, setSummary] = useState<PortalFacilitySummary | null>(null);
  const [message, setMessage] = useState("Loading portal scan status...");
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  useEffect(() => {
    void loadStatusAndSummary();
  }, []);

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
      setMessage(nextSummary.note ?? `Portal scan completed. ${nextSummary.totalFacilities} records found.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to scan portal.");
    } finally {
      setIsScanning(false);
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
              disabled={isScanning || isLoading}
              onClick={() => void scanPortal()}
              type="button"
            >
              <Search className="h-4 w-4" />
              {isScanning ? "Scanning..." : "Run Full Scan"}
            </button>
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
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Total facilities
                  </p>
                  <p className="mt-2 text-[24px] font-extrabold text-slate-950">
                    {summary ? formatCount(summary.totalFacilities) : "-"}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Last scanned
                  </p>
                  <p className="mt-2 text-[14px] font-semibold text-slate-950">
                    {summary?.lastScanned ?? "Never"}
                  </p>
                </div>
              </div>
              {summary ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {Object.entries(summary.statusCounts).map(([statusKey, count]) => (
                    <div className="rounded-2xl border border-slate-200 bg-white p-4" key={statusKey}>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                        {statusKey.replace(/_/g, " ")}
                      </p>
                      <p className="mt-2 text-[20px] font-semibold text-slate-950">{formatCount(count)}</p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-[17px] font-bold text-slate-950">Workflow Analytics</h2>
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Monthly registrations</p>
                  {summary?.monthlyRegistrationCounts.length ? (
                    <ul className="mt-3 space-y-2 text-[13px] text-slate-700">
                      {summary.monthlyRegistrationCounts.slice(-6).map((entry) => (
                        <li key={entry.month} className="flex items-center justify-between gap-3">
                          <span>{entry.month}</span>
                          <span className="font-semibold text-slate-950">{formatCount(entry.count)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-3 text-[13px] text-slate-500">No monthly registration data available.</p>
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Renewal counts by year</p>
                  {summary?.yearlyRenewalCounts.length ? (
                    <ul className="mt-3 space-y-2 text-[13px] text-slate-700">
                      {summary.yearlyRenewalCounts.map((entry) => (
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
              <h2 className="text-[17px] font-bold text-slate-950">Portal Notes</h2>
              <p className="mt-3 text-[14px] leading-6 text-slate-700">
                Run the full portal scan to build a cached dataset. Use the summary refresh button after new scans to keep the workflow stats current.
              </p>
            </div>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
