"use client";

import { safeFetchJson } from "@/lib/safeFetchJson";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  Loader2,
  RotateCcw,
  RefreshCw,
  Save,
  Trash2,
  Search,
  StopCircle,
  Table,
  Zap,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type PortalScanEvent = {
  at: string;
  category?: string;
  detailIndex?: number;
  detailTotal?: number;
  error?: string;
  facilityName?: string;
  hefamaaId?: string;
  id: string;
  message: string;
  durationMs?: number;
  attempt?: number;
  status: "capturing" | "captured" | "skipped" | "failed" | "info";
};

type PortalFacilitySummary = {
  totalFacilities: number;
  totalPortalRecords: number;
  portalReportedRecords: number | null;
  categoryCounts: Array<{ category: string; count: number }>;
  categoryPortalRecordCounts: Array<{ category: string; count: number }>;
  detailLastCaptured: string | null;
  detailRecords: number;
  applicationTypeCounts: Record<"new_registration" | "renewal" | "unknown", number>;
  facilityTypeCounts: Record<"new_registration" | "existing_facility" | "unknown", number>;
  statusCounts: Record<string, number>;
  scanProgress: {
    completedAt: string | null;
    keepAwakeActive?: boolean;
    openTabsCount?: number;
    scanId?: string | null;
    stopRequested?: boolean;
    currentFacilityHefamaaId?: string | null;
    currentFacilityName?: string | null;
    error?: string;
    detailTotal?: number;
    failedDetails?: number;
    lastCaptureMs?: number | null;
    lastCapturedFacilityName?: string | null;
    message?: string;
    phase?: "starting" | "waiting_for_login" | "finding_facilities" | "indexing_list" | "capturing_details" | "completed";
    portalReportedRecords: number | null;
    recentEvents?: PortalScanEvent[];
    scanMode?: "quick" | "full" | "fresh_full_scan";
    scannedDetails?: number;
    recapturedDetails?: number;
    bedsCapturedCount?: number;
    missingBedDataCount?: number;
    onlyMissingBeds?: boolean;
    scannedPages: number;
    scannedRecords: number;
    skippedDetails?: number;
    slowCaptures?: number;
    remainingDetails?: number;
    scanCompletionReport?: {
      averageCaptureTimeSeconds: number | null;
      failedFacilities: number;
      facilitiesUpdated: number;
      missingFields: Record<string, number>;
      newFieldsCaptured: number;
      skippedFacilities: number;
      totalScanTimeSeconds: number | null;
    };
    speedAnalytics?: {
      averageSecondsPerFacility: number | null;
      capturedSamples: number;
      estimatedSecondsRemaining: number | null;
      failedDueToTimeout: number;
      slowCaptures?: number;
      fastestFacility: { facilityName: string; seconds: number } | null;
      slowestFacility: { facilityName: string; seconds: number } | null;
    };
    startedAt: string | null;
    status: "idle" | "running" | "completed" | "failed" | "cancelled";
  };
  lastScanned: string | null;
  monthlyRegistrationCounts: Array<{ month: string; count: number }>;
  monthlyNewRegistrationCounts: Array<{ month: string; count: number }>;
  monthlyRenewalCounts: Array<{ month: string; count: number }>;
  yearlyPortalRecordCounts: Array<{ year: number; count: number }>;
  yearlyRenewalCounts: Array<{ year: number; count: number }>;
  note?: string;
};

type PortalScanProgress = PortalFacilitySummary["scanProgress"];

type PortalStartupMetrics = {
  browserLaunchMs: number | null;
  portalNavigationMs: number | null;
  loginDetectionMs: number | null;
  facilityListReadyMs: number | null;
  lastUpdatedAt: string | null;
};

type PortalStatusResult = {
  status: string;
  url: string | null;
  note: string;
  persistentProfile: boolean;
  profileLocked?: boolean;
  profileLockPid?: number;
  profileName: string;
  storageStateSaved?: boolean;
  lastLoginSavedAt?: string | null;
  startupMetrics?: PortalStartupMetrics;
  fullScanPreflight?: {
    browserOpen: boolean;
    browserConnected: boolean;
    sessionSaved: boolean;
    loggedIn: boolean;
    currentUrl: string | null;
    facilityListDetected: boolean;
    readyForFullScan: boolean;
    reason: string | null;
  };
  readyForFullScan?: boolean;
  fullScanBlockedReason?: string | null;
};

type PortalSessionManagerStatus = {
  browserOpen: boolean;
  loggedIn: boolean;
  facilityListDetected: boolean;
  currentPage: string | null;
  cachedFacilities: number;
  lastScan: string | null;
  scanRunning: boolean;
  openedAt: string | null;
  lastActivity: string | null;
  currentFacility: string | null;
  portalSessionState?: "active" | "expired" | "saved" | "missing";
  readyForFullScan?: boolean;
  fullScanBlockedReason?: string | null;
  storageStateSaved?: boolean;
  lastLoginSavedAt?: string | null;
  startupMetrics?: PortalStartupMetrics;
};

type PortalReleaseLockResult = {
  released: boolean;
  profileName: string;
  profileLocked: boolean;
  profileLockPid?: number;
  note: string;
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

type PortalWorkflowStatus =
  | "DOCUMENT_QUERY"
  | "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING"
  | "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING"
  | "DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING"
  | "INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING"
  | "FINAL_APPROVAL_PENDING";

type PortalWorkflowFacility = {
  id: string;
  facilityName: string | null;
  facilityCode: string | null;
  category: string | null;
  lga: string | null;
  currentWorkflowStatus: PortalWorkflowStatus;
  currentWorkflowStatusLabel: string;
  lastActivityDate: string | null;
  lastScanDate: string | null;
  rawStatus: string;
};

type PortalWorkflowSummary = {
  totalPortalRecords: number;
  statusCounts: Record<PortalWorkflowStatus, number>;
  lastScan: string | null;
  source: "portal_cache";
  facilities: PortalWorkflowFacility[];
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const result = await safeFetchJson<ApiResult<T>>(url, init);
  if (!result.ok) {
    throw new Error(result.status === 502 ? "Service temporarily unavailable" : result.error);
  }

  if (!result.data.ok) {
    throw new Error(result.data.error);
  }

  return result.data.data;
}

function formatCount(value: number) {
  return new Intl.NumberFormat("en-NG").format(value);
}

const workflowStatusLabels: Record<string, string> = {
  DOCUMENT_QUERY: "Document Query",
  UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: "Upload Payment/Document Approval Pending",
  PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: "Payment Approved/Document Approval Pending",
  DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING: "Document Approved/Inspection Report Pending",
  INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING: "Inspection Report Upload/Inspection Approval Pending",
  FINAL_APPROVAL_PENDING: "Final Approval Pending",
};

function statusLabel(status: string) {
  return workflowStatusLabels[status] ?? status.replace(/_/g, " ");
}

function mergeStopSummary(current: PortalFacilitySummary | null, next: PortalFacilitySummary) {
  if (!current) return next;

  const nextHasCounts = next.totalFacilities > 0 || next.totalPortalRecords > 0 || next.categoryCounts.length > 0;
  if (nextHasCounts) return next;

  return {
    ...current,
    detailRecords: Math.max(current.detailRecords, next.detailRecords),
    portalReportedRecords: next.portalReportedRecords ?? current.portalReportedRecords,
    scanProgress: next.scanProgress,
    note: next.note ?? current.note,
  };
}

function scanEventTone(status: PortalScanEvent["status"]) {
  if (status === "captured") return "border-blue-200 bg-blue-50 text-blue-900";
  if (status === "capturing") return "border-blue-200 bg-white text-blue-900";
  if (status === "failed") return "border-red-200 bg-red-50 text-red-900";
  if (status === "skipped") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-slate-50 text-slate-800";
}

function scanEventIcon(status: PortalScanEvent["status"]) {
  if (status === "capturing") return <Loader2 className="h-4 w-4 animate-spin text-blue-700" />;
  if (status === "captured") return <CheckCircle2 className="h-4 w-4 text-blue-700" />;
  if (status === "failed") return <AlertTriangle className="h-4 w-4 text-red-700" />;
  if (status === "skipped") return <AlertTriangle className="h-4 w-4 text-amber-700" />;
  return <Zap className="h-4 w-4 text-slate-500" />;
}

function progressPercent(current: number | null | undefined, total: number | null | undefined) {
  if (!total || total <= 0) return current && current > 0 ? 4 : 0;
  const percent = ((current ?? 0) / total) * 100;
  return Math.max(current && current > 0 ? 4 : 0, Math.min(100, percent));
}

const PORTAL_ROWS_PER_PAGE = 100;

function numericDate(value?: string | null) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatDurationFromSeconds(value?: number | null) {
  if (!value || !Number.isFinite(value) || value < 0) return "-";

  const totalSeconds = Math.round(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return hours + "h " + minutes + "m";
  if (minutes > 0) return minutes + "m " + seconds + "s";
  return seconds + "s";
}

function formatSecondsPerFacility(value?: number | null) {
  if (!value || !Number.isFinite(value) || value < 0) return "-";
  if (value >= 60) return formatDurationFromSeconds(value);
  return value.toFixed(value >= 10 ? 0 : 1) + "s";
}

function detailEventKey(event: PortalScanEvent) {
  return event.detailIndex ? String(event.detailIndex) : [event.facilityName, event.hefamaaId].filter(Boolean).join("|");
}

function getCurrentDetailIndex(progress: PortalScanProgress | null) {
  const events = progress?.recentEvents ?? [];
  const activeEvent = events.find((event) => event.status === "capturing" && event.detailIndex);
  if (activeEvent?.detailIndex) return activeEvent.detailIndex;

  const latestDetailEvent = events.find((event) => event.detailIndex);
  if (latestDetailEvent?.detailIndex) {
    if (progress?.status === "running" && latestDetailEvent.status === "captured") {
      return Math.min((progress.detailTotal ?? latestDetailEvent.detailIndex) || latestDetailEvent.detailIndex, latestDetailEvent.detailIndex + 1);
    }
    return latestDetailEvent.detailIndex;
  }

  if (progress?.status === "running" && progress.phase === "capturing_details") {
    return Math.min(progress.detailTotal ?? (progress.scannedDetails ?? 0) + 1, (progress.scannedDetails ?? 0) + 1);
  }

  return progress?.scannedDetails ?? 0;
}

function getDetailPosition(index: number, total?: number | null) {
  if (!index || index < 1) return null;

  return {
    page: Math.ceil(index / PORTAL_ROWS_PER_PAGE),
    row: ((index - 1) % PORTAL_ROWS_PER_PAGE) + 1,
    totalPages: total ? Math.ceil(total / PORTAL_ROWS_PER_PAGE) : null,
  };
}

function getRecentCaptureTiming(progress: PortalScanProgress | null, nowMs: number | null) {
  const events = [...(progress?.recentEvents ?? [])].sort((first, second) => (numericDate(first.at) ?? 0) - (numericDate(second.at) ?? 0));
  const startedByKey = new Map<string, PortalScanEvent>();
  const durations: number[] = [];

  for (const event of events) {
    const key = detailEventKey(event);
    if (!key) continue;

    if (event.status === "capturing") {
      startedByKey.set(key, event);
      continue;
    }

    if (event.status === "captured") {
      const started = startedByKey.get(key);
      const startedAt = numericDate(started?.at);
      const finishedAt = numericDate(event.at);
      if (!startedAt || !finishedAt) continue;

      const duration = (finishedAt - startedAt) / 1000;
      if (duration > 0 && duration < 600) durations.push(duration);
    }
  }

  const averageSeconds = durations.length ? durations.reduce((total, value) => total + value, 0) / durations.length : null;
  const lastSeconds = durations.length ? durations[durations.length - 1] : null;
  const remaining = progress?.detailTotal && progress.detailTotal > (progress.scannedDetails ?? 0) ? progress.detailTotal - (progress.scannedDetails ?? 0) : 0;
  const estimatedRemainingSeconds = averageSeconds && remaining ? averageSeconds * remaining : null;
  const activeEvent = (progress?.recentEvents ?? []).find((event) => event.status === "capturing" && event.detailIndex === getCurrentDetailIndex(progress))
    ?? (progress?.recentEvents ?? []).find((event) => event.status === "capturing");
  const activeStartedAt = numericDate(activeEvent?.at);
  const activeSeconds = activeStartedAt && nowMs ? Math.max(0, (nowMs - activeStartedAt) / 1000) : null;

  return {
    activeSeconds,
    averageSeconds,
    estimatedRemainingSeconds,
    lastSeconds,
    perMinute: averageSeconds ? 60 / averageSeconds : null,
    sampleSize: durations.length,
  };
}

function exportQuerySuffix(query?: string) {
  const trimmed = query?.trim();
  return trimmed ? "?query=" + encodeURIComponent(trimmed) : "";
}

function ExportDropdown({ query, align = "right", compact = false }: { query?: string; align?: "left" | "right"; compact?: boolean }) {
  const suffix = exportQuerySuffix(query);
  const items = [
    { href: "/api/portal/export/excel" + suffix, label: "Excel workbook", description: "Clean row data", icon: FileSpreadsheet },
    { href: "/api/portal/export/pdf" + suffix, label: "PDF report", description: "Printable records", icon: FileText },
    { href: "/api/portal/export/visual" + suffix, label: "Visual report", description: "Charts for presentation", icon: BarChart3 },
  ];

  return (
    <details className="group relative inline-block [&>summary::-webkit-details-marker]:hidden">
      <summary
        className={[
          "relative flex cursor-pointer list-none items-center justify-center transition",
          compact
            ? "h-12 w-12 rounded-2xl border border-white/45 bg-blue-600 text-white shadow-[0_10px_0_rgba(30,64,175,0.48),0_18px_34px_rgba(15,23,42,0.24)] ring-1 ring-blue-200/80 hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-[0_12px_0_rgba(30,64,175,0.50),0_22px_38px_rgba(15,23,42,0.26)] active:translate-y-1 active:shadow-[0_4px_0_rgba(30,64,175,0.48),0_10px_22px_rgba(15,23,42,0.20)]"
            : "h-11 gap-2 rounded-lg border border-blue-200 bg-blue-600 px-4 text-[13px] font-extrabold text-white shadow-[0_14px_30px_rgba(37,99,235,0.22)] hover:bg-blue-700",
        ].join(" ")}
        title="Export data"
      >
        <Download className={compact ? "h-5 w-5" : "h-4 w-4"} />
        {compact ? (
          <>
            <span className="sr-only">Export</span>
            <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
              Export
            </span>
          </>
        ) : (
          <>
            Export
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
          </>
        )}
      </summary>
      <div className={["absolute z-30 mt-2 w-64 overflow-hidden rounded-xl border border-slate-200 bg-white p-2 shadow-2xl", align === "right" ? "right-0" : "left-0"].join(" ")}>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <a className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-blue-50" href={item.href} key={item.href}>
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                <Icon className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-[13px] font-extrabold text-slate-950">{item.label}</span>
                <span className="mt-0.5 block text-[11px] font-semibold text-slate-500">{item.description}</span>
              </span>
            </a>
          );
        })}
      </div>
    </details>
  );
}

function MiniBarList({ rows, tone = "blue" }: { rows: Array<{ label: string; count: number }>; tone?: "blue" | "blue" | "amber" }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  const fill = tone === "blue" ? "bg-blue-600" : tone === "amber" ? "bg-amber-500" : "bg-blue-600";

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label}>
          <div className="mb-1 flex items-center justify-between gap-3 text-[12px] font-bold text-slate-700">
            <span className="truncate">{row.label}</span>
            <span className="shrink-0 text-slate-950">{formatCount(row.count)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100">
            <div className={["h-full rounded-full", fill].join(" ")} style={{ width: Math.max(3, (row.count / max) * 100) + "%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function PortalScanPage() {
  const [status, setStatus] = useState<PortalStatusResult | null>(null);
  const [sessionStatus, setSessionStatus] = useState<PortalSessionManagerStatus | null>(null);
  const [summary, setSummary] = useState<PortalFacilitySummary | null>(null);
  const [message, setMessage] = useState("Loading portal scan status...");
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isReleasingLock, setIsReleasingLock] = useState(false);
  const [isSavingSession, setIsSavingSession] = useState(false);
  const [isReconnectingSession, setIsReconnectingSession] = useState(false);
  const [isClearingSession, setIsClearingSession] = useState(false);
  const [cacheQuery, setCacheQuery] = useState("");
  const [cachedRecords, setCachedRecords] = useState<PortalRecordsResult | null>(null);
  const [workflowSummary, setWorkflowSummary] = useState<PortalWorkflowSummary | null>(null);
  const [selectedWorkflowStatus, setSelectedWorkflowStatus] = useState<PortalWorkflowStatus | null>(null);
  const [showFreshScanConfirm, setShowFreshScanConfirm] = useState(false);
  const [onlyMissingBeds, setOnlyMissingBeds] = useState(true);
  const [isSearchingCache, setIsSearchingCache] = useState(false);
  const [nowMs, setNowMs] = useState<number | null>(null);

  const isScanRunning = summary?.scanProgress.status === "running";
  const runningScanMode = summary?.scanProgress.scanMode ?? "quick";
  const scanProgress = summary?.scanProgress ?? null;
  const currentScanMode = scanProgress?.scanMode ?? runningScanMode;
  const isDetailScanMode = currentScanMode === "full" || currentScanMode === "fresh_full_scan";
  const scanStarted = Boolean(scanProgress?.startedAt) && scanProgress?.status !== "idle";
  const listProgressTotal = scanProgress?.portalReportedRecords ?? summary?.portalReportedRecords ?? null;
  const detailProgressTotal = scanProgress?.detailTotal ?? summary?.totalPortalRecords ?? null;
  const topCategoryRows = summary?.categoryCounts.slice(0, 8).map((entry) => ({ label: entry.category, count: entry.count })) ?? [];
  const statusRows = workflowSummary ? Object.entries(workflowSummary.statusCounts).map(([label, count]) => ({ label: statusLabel(label), count })) : [];
  const yearlyRows = summary?.yearlyPortalRecordCounts.map((entry) => ({ label: String(entry.year), count: entry.count })) ?? [];
  const currentDetailIndex = getCurrentDetailIndex(scanProgress);
  const currentDetailPosition = getDetailPosition(currentDetailIndex, detailProgressTotal);
  const captureTiming = getRecentCaptureTiming(scanProgress, nowMs);
  const speedAnalytics = scanProgress?.speedAnalytics;
  const averageCaptureSeconds = speedAnalytics?.averageSecondsPerFacility ?? captureTiming.averageSeconds;
  const estimatedRemainingSeconds = speedAnalytics?.estimatedSecondsRemaining ?? captureTiming.estimatedRemainingSeconds;
  const captureSampleSize = speedAnalytics?.capturedSamples ?? captureTiming.sampleSize;
  const capturePerMinute = averageCaptureSeconds ? 60 / averageCaptureSeconds : null;
  const portalSessionReady = Boolean(sessionStatus?.browserOpen && sessionStatus.loggedIn);
  const scanReady = portalSessionReady;
  const quickScanReady = scanReady && !isScanning && !isLoading && !isScanRunning;
  const fullScanReady = Boolean(portalSessionReady && !isScanning && !isLoading && !isScanRunning);
  const selectedWorkflowFacilities = selectedWorkflowStatus
    ? (workflowSummary?.facilities ?? []).filter((facility) => facility.currentWorkflowStatus === selectedWorkflowStatus)
    : [];

  useEffect(() => {
    void loadStatusAndSummary();
  }, []);

  useEffect(() => {
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const pollSessionStatus = async () => {
      try {
        const nextSessionStatus = await fetchApi<PortalSessionManagerStatus>("/api/portal/session/status");
        setSessionStatus(nextSessionStatus);
      } catch {
        // Session polling is informational; scan actions still surface concrete API errors.
      }
    };

    const timer = window.setInterval(() => void pollSessionStatus(), 2_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!isScanRunning) return;

    const pollSummary = async () => {
      try {
        const [nextSummary, nextSessionStatus, nextWorkflowSummary] = await Promise.all([
          fetchApi<PortalFacilitySummary>("/api/portal/summary"),
          fetchApi<PortalSessionManagerStatus>("/api/portal/session/status"),
          fetchApi<PortalWorkflowSummary>("/api/portal/workflow-summary"),
        ]);
        setSummary(nextSummary);
        setSessionStatus(nextSessionStatus);
        setWorkflowSummary(nextWorkflowSummary);
        if (nextSummary.scanProgress.status === "completed") {
          setMessage(nextSummary.scanProgress.scanMode === "full" || nextSummary.scanProgress.scanMode === "fresh_full_scan"
            ? "Full detail scan completed. Portal details are saved for offline AI answers."
            : "Quick scan completed. Portal analytics and summaries are ready.");
        } else if (nextSummary.scanProgress.status === "cancelled") {
          setMessage(nextSummary.scanProgress.message ?? "Stop requested. Scan will stop after current facility.");
        } else if (nextSummary.scanProgress.status === "failed") {
          setMessage(nextSummary.scanProgress.error ?? "Portal scan failed.");
        } else if (nextSummary.scanProgress.status === "running" && nextSummary.scanProgress.message) {
          setMessage(nextSummary.scanProgress.message);
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Unable to refresh portal scan progress.");
      }
    };

    const timer = window.setInterval(() => void pollSummary(), 1_000);
    return () => window.clearInterval(timer);
  }, [isScanRunning]);

  async function loadStatusAndSummary() {
    setIsLoading(true);
    setMessage("Loading portal status and summary...");

    try {
      const [nextStatus, nextSummary, nextSessionStatus, nextWorkflowSummary] = await Promise.all([
        fetchApi<PortalStatusResult>("/api/portal/status"),
        fetchApi<PortalFacilitySummary>("/api/portal/summary"),
        fetchApi<PortalSessionManagerStatus>("/api/portal/session/status"),
        fetchApi<PortalWorkflowSummary>("/api/portal/workflow-summary"),
      ]);
      setStatus(nextStatus);
      setSummary(nextSummary);
      setSessionStatus(nextSessionStatus);
      setWorkflowSummary(nextWorkflowSummary);
      if (nextSummary.scanProgress.status === "failed") {
        setMessage(nextSummary.scanProgress.error ?? "Portal scan failed. Log in to the portal and run the scan again.");
      } else if (nextSummary.scanProgress.status === "cancelled") {
        setMessage(nextSummary.scanProgress.message ?? "Portal scan stopped. Restart Full Detail Scan to resume from cached captures.");
      } else if (nextSummary.scanProgress.status === "running") {
        setMessage(nextSummary.scanProgress.message ?? (nextSummary.scanProgress.scanMode === "full" || nextSummary.scanProgress.scanMode === "fresh_full_scan"
          ? "Full detail scan is running. Facility records are being captured into the local offline index."
          : "Quick portal scan is running. Analytics will update as rows are indexed."));
      } else if (nextSummary.scanProgress.status === "completed") {
        setMessage(nextSummary.scanProgress.scanMode === "full" || nextSummary.scanProgress.scanMode === "fresh_full_scan"
          ? "Full detail scan completed. Portal details are saved for offline AI answers."
          : "Quick scan completed. Portal analytics and summaries are ready.");
      } else {
        setMessage(nextSummary.note ?? "Portal scan summary loaded.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load portal scan data.");
    } finally {
      setIsLoading(false);
    }
  }

  async function openPortal() {
    setIsOpening(true);
    setMessage("Opening controlled portal browser...");

    try {
      const nextStatus = await fetchApi<PortalStatusResult>("/api/portal/open", {
        method: "POST",
      });
      const nextSessionStatus = await fetchApi<PortalSessionManagerStatus>("/api/portal/session/status");
      setStatus(nextStatus);
      setSessionStatus(nextSessionStatus);
      setMessage(nextStatus.note ?? "Portal browser opened. Log in manually if needed, then navigate to the facility list before scanning.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to open portal.");
    } finally {
      setIsOpening(false);
    }
  }

  async function scanPortal(mode: "quick" | "full" | "fresh_full_scan", options: { onlyMissingBeds?: boolean } = {}) {
    setIsScanning(true);
    setMessage(mode === "fresh_full_scan"
      ? "Starting Fresh Full Scan. Existing records will be updated without creating duplicates..."
      : mode === "full"
        ? "Starting full detail scan. The agent will open the current-year record when available, otherwise the latest valid available renewal record..."
        : "Starting quick portal scan for analytics and summaries...");

    try {
      const nextSummary = await fetchApi<PortalFacilitySummary>("/api/portal/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, onlyMissingBeds: options.onlyMissingBeds }),
      });
      setSummary(nextSummary);
      const [nextSessionStatus, nextWorkflowSummary] = await Promise.all([
        fetchApi<PortalSessionManagerStatus>("/api/portal/session/status"),
        fetchApi<PortalWorkflowSummary>("/api/portal/workflow-summary"),
      ]);
      setSessionStatus(nextSessionStatus);
      setWorkflowSummary(nextWorkflowSummary);
      setMessage(mode === "fresh_full_scan"
        ? "Fresh Full Scan started in the background. Progress will show recaptured records and bed-field coverage."
        : mode === "full"
          ? "Full detail scan started in the background. It will skip older yearly renewal portals and capture the latest/current facility details."
          : "Quick scan started in the background. Progress will update automatically.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to scan portal.");
    } finally {
      setIsScanning(false);
    }
  }

  async function stopScan() {
    setIsStopping(true);
    setMessage("Stop requested. Scan will stop after the current facility finishes. The portal session will stay open.");
    setSummary((current) => current
      ? {
          ...current,
          scanProgress: {
            ...current.scanProgress,
            completedAt: null,
            currentFacilityHefamaaId: current.scanProgress.currentFacilityHefamaaId ?? null,
            currentFacilityName: current.scanProgress.currentFacilityName ?? null,
            message: "Stop requested. Scan will stop after the current facility finishes.",
            status: "running",
            stopRequested: true,
          },
        }
      : current);

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5_000);

    try {
      const nextSummary = await fetchApi<PortalFacilitySummary>("/api/portal/scan/stop", {
        method: "POST",
        signal: controller.signal,
      });
      setSummary((current) => mergeStopSummary(current, nextSummary));
      setMessage(nextSummary.scanProgress.message ?? "Portal scan stopped. Restart Full Detail Scan to resume from cached captures.");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Stop request was sent. Refresh the portal scan summary in a few seconds to confirm the worker has exited.");
        return;
      }

      setMessage(error instanceof Error ? error.message : "Unable to stop portal scan.");
    } finally {
      window.clearTimeout(timeout);
      setIsStopping(false);
    }
  }

  async function savePortalSession() {
    setIsSavingSession(true);
    setMessage("Saving controlled portal session...");
    try {
      const result = await fetchApi<{ note?: string; lastLoginSavedAt?: string | null; storageStateSaved?: boolean }>("/api/portal/session/save", { method: "POST" });
      setSessionStatus(await fetchApi<PortalSessionManagerStatus>("/api/portal/session/status"));
      setStatus((current) => current ? { ...current, storageStateSaved: result.storageStateSaved, lastLoginSavedAt: result.lastLoginSavedAt } : current);
      setMessage(result.note ?? "Portal session saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save portal session.");
    } finally {
      setIsSavingSession(false);
    }
  }

  async function reconnectPortalSession() {
    setIsReconnectingSession(true);
    setMessage("Reconnecting controlled portal session...");
    try {
      const result = await fetchApi<{ note?: string; lastLoginSavedAt?: string | null; sessionState?: string; storageStateSaved?: boolean }>("/api/portal/session/reconnect", { method: "POST" });
      const nextSessionStatus = await fetchApi<PortalSessionManagerStatus>("/api/portal/session/status");
      setSessionStatus(nextSessionStatus);
      setMessage(result.note ?? (nextSessionStatus.loggedIn ? "Portal session reconnected." : "Portal session expired. Please login again."));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to reconnect portal session.");
    } finally {
      setIsReconnectingSession(false);
    }
  }

  async function clearPortalSession() {
    setIsClearingSession(true);
    setMessage("Clearing saved portal session...");
    try {
      const result = await fetchApi<{ note?: string; lastLoginSavedAt?: string | null; storageStateSaved?: boolean }>("/api/portal/session/clear", { method: "POST" });
      setSessionStatus(await fetchApi<PortalSessionManagerStatus>("/api/portal/session/status"));
      setStatus((current) => current ? { ...current, storageStateSaved: result.storageStateSaved, lastLoginSavedAt: result.lastLoginSavedAt } : current);
      setMessage(result.note ?? "Saved portal session cleared.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to clear portal session.");
    } finally {
      setIsClearingSession(false);
    }
  }

  async function releasePortalLock() {
    setIsReleasingLock(true);
    setMessage("Releasing stale portal browser session lock...");

    try {
      const result = await fetchApi<PortalReleaseLockResult>("/api/portal/release-lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      setStatus((current) => current
        ? { ...current, profileLocked: result.profileLocked, profileLockPid: result.profileLockPid, profileName: result.profileName }
        : {
            status: "closed",
            url: null,
            note: result.note,
            persistentProfile: true,
            profileLocked: result.profileLocked,
            profileLockPid: result.profileLockPid,
            profileName: result.profileName,
          });
      setMessage(result.note ?? "Portal browser session lock released. Run Full Detail Scan again.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to release portal browser session lock.");
    } finally {
      setIsReleasingLock(false);
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
      <section className="space-y-6 bg-[#f6f9ff] px-4 py-6 xl:px-6 2xl:px-7">
        <div className="rounded-2xl border border-blue-900/10 bg-[linear-gradient(135deg,#061923,#1e40af_62%,#2563eb)] p-5 text-white shadow-[0_22px_55px_rgba(6,25,35,0.18)] md:flex md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-blue-100">HEFAMAA Portal Intelligence</p>
            <h1 className="mt-2 text-[28px] font-extrabold tracking-[-0.03em] text-white">
              Portal Scan & Workflow Monitor
            </h1>
            <p className="mt-1 max-w-3xl text-[14px] font-semibold leading-6 text-blue-50/90">
              Fast analytics, resumable detail capture, exports, and visual reports from the portal cache.
            </p>
          </div>
          <div className="mt-5 flex flex-wrap justify-start gap-2.5 md:mt-0 md:max-w-[320px] md:justify-end">
            <button
              aria-label={isOpening ? "Opening HEFAMAA portal" : "Open HEFAMAA portal"}
              className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/45 bg-white text-blue-800 shadow-[0_10px_0_rgba(8,47,73,0.28),0_18px_34px_rgba(15,23,42,0.22)] ring-1 ring-blue-100/80 transition hover:-translate-y-0.5 hover:shadow-[0_12px_0_rgba(8,47,73,0.30),0_22px_38px_rgba(15,23,42,0.24)] active:translate-y-1 active:shadow-[0_4px_0_rgba(8,47,73,0.28),0_10px_22px_rgba(15,23,42,0.20)] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isOpening || isLoading}
              onClick={() => void openPortal()}
              title={isOpening ? "Opening Portal" : "Open Portal"}
              type="button"
            >
              {isOpening ? <Loader2 className="h-5 w-5 animate-spin" /> : <ExternalLink className="h-5 w-5" />}
              <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                Portal
              </span>
            </button>
            <button
              aria-label="Save portal session"
              className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/45 bg-emerald-50 text-emerald-700 shadow-[0_10px_0_rgba(4,120,87,0.24),0_18px_34px_rgba(15,23,42,0.18)] ring-1 ring-emerald-100/80 transition hover:-translate-y-0.5 hover:bg-white active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!sessionStatus?.browserOpen || isSavingSession}
              onClick={() => void savePortalSession()}
              title="Save Portal Session"
              type="button"
            >
              {isSavingSession ? <Loader2 className="h-5 w-5 animate-spin" /> : <Save className="h-5 w-5" />}
              <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                Save Session
              </span>
            </button>
            <button
              aria-label="Reconnect portal session"
              className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/45 bg-cyan-50 text-cyan-700 shadow-[0_10px_0_rgba(14,116,144,0.24),0_18px_34px_rgba(15,23,42,0.18)] ring-1 ring-cyan-100/80 transition hover:-translate-y-0.5 hover:bg-white active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isReconnectingSession || isLoading}
              onClick={() => void reconnectPortalSession()}
              title="Reconnect Portal"
              type="button"
            >
              {isReconnectingSession ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
              <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                Reconnect
              </span>
            </button>
            <button
              aria-label="Clear saved portal session"
              className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/45 bg-slate-50 text-slate-700 shadow-[0_10px_0_rgba(51,65,85,0.22),0_18px_34px_rgba(15,23,42,0.18)] ring-1 ring-slate-100/80 transition hover:-translate-y-0.5 hover:bg-white active:translate-y-1 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={isClearingSession || isScanRunning}
              onClick={() => void clearPortalSession()}
              title="Clear Portal Session"
              type="button"
            >
              {isClearingSession ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
              <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                Clear Session
              </span>
            </button>
            <button
              aria-label="Run quick portal scan"
              className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/45 bg-blue-50 text-blue-700 shadow-[0_10px_0_rgba(29,78,216,0.30),0_18px_34px_rgba(15,23,42,0.20)] ring-1 ring-blue-100/80 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_0_rgba(29,78,216,0.32),0_22px_38px_rgba(15,23,42,0.22)] active:translate-y-1 active:shadow-[0_4px_0_rgba(29,78,216,0.30),0_10px_22px_rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!quickScanReady}
              onClick={() => void scanPortal("quick")}
              title={quickScanReady ? "Run Quick Scan" : "Open portal and log in first"}
              type="button"
            >
              {isScanning && runningScanMode === "quick" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Search className="h-5 w-5" />}
              <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                Quick Scan
              </span>
            </button>
            <button
              aria-label="Run full detail scan"
              className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/45 bg-blue-600 text-white shadow-[0_10px_0_rgba(30,64,175,0.48),0_18px_34px_rgba(15,23,42,0.24)] ring-1 ring-blue-200/80 transition hover:-translate-y-0.5 hover:bg-blue-500 hover:shadow-[0_12px_0_rgba(30,64,175,0.50),0_22px_38px_rgba(15,23,42,0.26)] active:translate-y-1 active:shadow-[0_4px_0_rgba(30,64,175,0.48),0_10px_22px_rgba(15,23,42,0.20)] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!fullScanReady}
              onClick={() => void scanPortal("full")}
              title={fullScanReady ? "Run Full Detail Scan" : "Open portal and log in first"}
              type="button"
            >
              {isScanning && runningScanMode === "full" ? <Loader2 className="h-5 w-5 animate-spin" /> : <Zap className="h-5 w-5" />}
              <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                Full Scan
              </span>
            </button>
            <button
              aria-label="Run fresh full scan"
              className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/45 bg-indigo-50 text-indigo-700 shadow-[0_10px_0_rgba(67,56,202,0.30),0_18px_34px_rgba(15,23,42,0.20)] ring-1 ring-indigo-100/80 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_0_rgba(67,56,202,0.32),0_22px_38px_rgba(15,23,42,0.22)] active:translate-y-1 active:shadow-[0_4px_0_rgba(67,56,202,0.30),0_10px_22px_rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!fullScanReady}
              onClick={() => setShowFreshScanConfirm(true)}
              title={fullScanReady ? "Fresh Full Scan" : "Open portal and log in first"}
              type="button"
            >
              {isScanning && runningScanMode === "fresh_full_scan" ? <Loader2 className="h-5 w-5 animate-spin" /> : <RotateCcw className="h-5 w-5" />}
              <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                Fresh Full Scan
              </span>
            </button>
            {isScanRunning ? (
              <button
                aria-label="Stop portal scan"
                className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-red-200 bg-red-50 text-red-700 shadow-[0_10px_0_rgba(185,28,28,0.28),0_18px_34px_rgba(15,23,42,0.20)] ring-1 ring-red-100 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_0_rgba(185,28,28,0.30),0_22px_38px_rgba(15,23,42,0.22)] active:translate-y-1 active:shadow-[0_4px_0_rgba(185,28,28,0.28),0_10px_22px_rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:opacity-55"
                disabled={isStopping}
                onClick={() => void stopScan()}
                title={isStopping ? "Stopping Scan" : "Stop Scan"}
                type="button"
              >
                {isStopping ? <Loader2 className="h-5 w-5 animate-spin" /> : <StopCircle className="h-5 w-5" />}
                <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                  Stop Scan
                </span>
              </button>
            ) : (
              <button
                aria-label="Refresh portal scan summary"
                className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-white/45 bg-white text-slate-700 shadow-[0_10px_0_rgba(15,23,42,0.24),0_18px_34px_rgba(15,23,42,0.20)] ring-1 ring-slate-200/80 transition hover:-translate-y-0.5 hover:shadow-[0_12px_0_rgba(15,23,42,0.26),0_22px_38px_rgba(15,23,42,0.22)] active:translate-y-1 active:shadow-[0_4px_0_rgba(15,23,42,0.24),0_10px_22px_rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:opacity-55"
                disabled={isLoading}
                onClick={() => void loadStatusAndSummary()}
                title="Refresh Summary"
                type="button"
              >
                <RefreshCw className="h-5 w-5" />
                <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                  Refresh
                </span>
              </button>
            )}
            {!isScanRunning && status?.profileLocked ? (
              <button
                aria-label="Release stale portal browser session lock"
                className="group relative flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200 bg-amber-50 text-amber-800 shadow-[0_10px_0_rgba(180,83,9,0.30),0_18px_34px_rgba(15,23,42,0.20)] ring-1 ring-amber-100 transition hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_12px_0_rgba(180,83,9,0.32),0_22px_38px_rgba(15,23,42,0.22)] active:translate-y-1 active:shadow-[0_4px_0_rgba(180,83,9,0.30),0_10px_22px_rgba(15,23,42,0.18)] disabled:cursor-not-allowed disabled:opacity-55"
                disabled={isReleasingLock || isScanning}
                onClick={() => void releasePortalLock()}
                title={isReleasingLock ? "Releasing Lock" : "Release Lock"}
                type="button"
              >
                {isReleasingLock ? <Loader2 className="h-5 w-5 animate-spin" /> : <AlertTriangle className="h-5 w-5" />}
                <span className="pointer-events-none absolute -top-8 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 text-[11px] font-bold text-white shadow-lg group-hover:block">
                  Release Lock
                </span>
              </button>
            ) : null}
            <ExportDropdown compact />
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]">
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
                    Session Lock
                  </p>
                  <p className="mt-2 text-[14px] font-semibold text-slate-950">
                    {status?.profileLocked ? `Locked${status.profileLockPid ? ` (${status.profileLockPid})` : ""}` : "Unlocked"}
                  </p>
                </div>
                {[
                  ["Portal Session", sessionStatus?.portalSessionState === "active" ? "Active" : sessionStatus?.portalSessionState === "expired" ? "Expired" : sessionStatus?.storageStateSaved || status?.storageStateSaved ? "Saved" : "Missing"],
                  ["Last Login Saved", sessionStatus?.lastLoginSavedAt ?? status?.lastLoginSavedAt ?? "Not saved"],
                  ["Browser", sessionStatus?.browserOpen ? "Open" : "Closed"],
                  ["Logged In", sessionStatus?.loggedIn ? "Yes" : "No"],
                  ["Facility Table", sessionStatus?.facilityListDetected ? "Detected" : "Not detected"],
                  ["Quick Scan Ready", quickScanReady ? "Ready" : "Waiting"],
                  ["Full Scan Ready", sessionStatus?.readyForFullScan ? "Ready" : sessionStatus?.fullScanBlockedReason || "Waiting"],
                  ["Facilities Cached", sessionStatus ? formatCount(sessionStatus.cachedFacilities) : "-"],
                  ["Current Facility", sessionStatus?.currentFacility || scanProgress?.currentFacilityName || "None"],
                  ["Scan Status", scanProgress?.stopRequested ? "Stop requested" : scanProgress?.status ?? "Idle"],
                  ["Keep Awake", scanProgress?.keepAwakeActive ? "Active" : "Idle"],
                  ["Open Tabs", formatCount(scanProgress?.openTabsCount ?? 0)],
                  ["Last Activity", sessionStatus?.lastActivity ?? "-"],
                ].map(([label, value]) => (
                  <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4" key={label}>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-blue-700">{label}</p>
                    <p className="mt-2 break-words text-[14px] font-semibold text-slate-950">{value}</p>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-blue-700">Startup Performance</p>
                    <p className="mt-1 text-[12px] font-semibold text-slate-500">Controlled browser overhead only; portal server/network time may vary.</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Browser Launch Time", sessionStatus?.startupMetrics?.browserLaunchMs ?? status?.startupMetrics?.browserLaunchMs],
                    ["Portal Load Time", sessionStatus?.startupMetrics?.portalNavigationMs ?? status?.startupMetrics?.portalNavigationMs],
                    ["Login Ready Time", sessionStatus?.startupMetrics?.loginDetectionMs ?? status?.startupMetrics?.loginDetectionMs],
                    ["Facility List Ready Time", sessionStatus?.startupMetrics?.facilityListReadyMs ?? status?.startupMetrics?.facilityListReadyMs],
                  ].map(([label, value]) => (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" key={String(label)}>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">{label}</p>
                      <p className="mt-2 text-[15px] font-extrabold text-slate-950">{typeof value === "number" ? `${value}ms` : "-"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3">
                <Zap className="h-5 w-5 text-blue-600" />
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
                <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-blue-700">New registrations</p>
                  <p className="mt-2 text-[24px] font-extrabold text-blue-900">{summary ? formatCount(summary.facilityTypeCounts.new_registration) : "-"}</p>
                </div>
                <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-indigo-700">Existing facilities</p>
                  <p className="mt-2 text-[24px] font-extrabold text-indigo-900">{summary ? formatCount(summary.facilityTypeCounts.existing_facility) : "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Last scanned</p>
                  <p className="mt-2 text-[12px] font-semibold text-slate-950">{summary?.lastScanned ?? "Never"}</p>
                </div>
                <div className="rounded-xl border border-purple-200 bg-purple-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-purple-700">Offline detail records</p>
                  <p className="mt-2 text-[24px] font-extrabold text-purple-900">{summary ? formatCount(summary.detailRecords) : "-"}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Details last captured</p>
                  <p className="mt-2 text-[12px] font-semibold text-slate-950">{summary?.detailLastCaptured ?? "Never"}</p>
                </div>
              </div>
              {scanStarted ? (
                <div className={
                  "mt-4 rounded-xl border p-4 " +
                  (scanProgress?.status === "failed"
                    ? "border-red-200 bg-red-50"
                    : scanProgress?.status === "completed"
                      ? "border-blue-200 bg-blue-50"
                      : "border-blue-200 bg-blue-50")
                }>
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex items-start gap-3">
                      {scanProgress?.status === "running" ? (
                        <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-blue-700" />
                      ) : scanProgress?.status === "completed" ? (
                        <CheckCircle2 className="mt-0.5 h-5 w-5 text-blue-700" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-5 w-5 text-red-700" />
                      )}
                      <div>
                        <p className={
                          "text-[13px] font-extrabold " +
                          (scanProgress?.status === "failed"
                            ? "text-red-950"
                            : scanProgress?.status === "completed"
                              ? "text-blue-950"
                              : "text-blue-950")
                        }>
                          {scanProgress?.stopRequested ? "Stop requested" : isDetailScanMode ? currentScanMode === "fresh_full_scan" ? "Fresh scan running" : "Full detail scan" : "Quick portal scan"} {scanProgress?.stopRequested ? "" : scanProgress?.status === "running" ? "in progress" : scanProgress?.status}
                        </p>
                        {scanProgress?.message ? (
                          <p className="mt-1 text-[12px] font-semibold leading-5 text-slate-700">{scanProgress.message}</p>
                        ) : null}
                        <p className="mt-1 text-[12px] leading-5 text-slate-600">
                          Started: {scanProgress?.startedAt ?? "-"}
                          {scanProgress?.completedAt ? " | Finished: " + scanProgress.completedAt : ""}
                        </p>
                      </div>
                    </div>
                    <span className={
                      "inline-flex h-7 w-fit items-center rounded-full px-3 text-[11px] font-extrabold uppercase tracking-[0.12em] " +
                      (scanProgress?.status === "failed"
                        ? "bg-red-100 text-red-800"
                        : scanProgress?.status === "completed"
                          ? "bg-blue-100 text-blue-800"
                          : "bg-blue-100 text-blue-800")
                    }>
                      {scanProgress?.phase ? scanProgress.phase.replace(/_/g, " ") : scanProgress?.status ?? "idle"}
                    </span>
                  </div>

                  {scanProgress?.status === "failed" ? (
                    <div className="mt-4 rounded-lg border border-red-200 bg-white/80 p-3 text-[13px] leading-5 text-red-900">
                      <p className="font-bold">The scan stopped before completion.</p>
                      <p className="mt-1">{scanProgress.error ?? "No detailed error was returned."}</p>
                      <p className="mt-2 text-red-800">Run Full Detail Scan again. Already captured facilities will be skipped, and the scan will continue from the local detail cache.</p>
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-5">
                    <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Indexed rows</p>
                      <p className="mt-1 text-[18px] font-extrabold text-slate-950">{formatCount(scanProgress?.scannedRecords ?? 0)}</p>
                    </div>
                    <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Scanned pages</p>
                      <p className="mt-1 text-[18px] font-extrabold text-slate-950">{formatCount(scanProgress?.scannedPages ?? 0)}</p>
                    </div>
                    <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                      <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Captured details</p>
                      <p className="mt-1 text-[18px] font-extrabold text-slate-950">
                        {formatCount(scanProgress?.scannedDetails ?? 0)}{isDetailScanMode ? " / " + formatCount(detailProgressTotal ?? 0) : ""}
                      </p>
                    </div>
                    {isDetailScanMode ? (
                      <>
                        <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Failed details</p>
                          <p className="mt-1 text-[18px] font-extrabold text-red-700">{formatCount(scanProgress?.failedDetails ?? 0)}</p>
                        </div>
                        <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Skipped details</p>
                          <p className="mt-1 text-[18px] font-extrabold text-amber-700">{formatCount(scanProgress?.skippedDetails ?? 0)}</p>
                        </div>
                        <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Remaining</p>
                          <p className="mt-1 text-[18px] font-extrabold text-slate-950">{formatCount(scanProgress?.remainingDetails ?? Math.max(0, (detailProgressTotal ?? 0) - (scanProgress?.scannedDetails ?? 0) - (scanProgress?.failedDetails ?? 0) - (scanProgress?.skippedDetails ?? 0)))}</p>
                        </div>
                        <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Slow captures</p>
                          <p className="mt-1 text-[18px] font-extrabold text-orange-700">{formatCount(scanProgress?.slowCaptures ?? scanProgress?.speedAnalytics?.slowCaptures ?? 0)}</p>
                        </div>
                        <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Open tabs</p>
                          <p className="mt-1 text-[18px] font-extrabold text-blue-700">{formatCount(scanProgress?.openTabsCount ?? 0)}</p>
                        </div>
                        <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Stop signal</p>
                          <p className="mt-1 text-[14px] font-extrabold text-slate-950">{scanProgress?.stopRequested ? "Requested" : "Clear"}</p>
                        </div>
                        {currentScanMode === "fresh_full_scan" ? (
                          <>
                            <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Recaptured</p>
                              <p className="mt-1 text-[18px] font-extrabold text-indigo-700">{formatCount(scanProgress?.recapturedDetails ?? 0)}</p>
                            </div>
                            <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Beds captured</p>
                              <p className="mt-1 text-[18px] font-extrabold text-blue-700">{formatCount(scanProgress?.bedsCapturedCount ?? 0)}</p>
                            </div>
                            <div className="rounded-lg border border-white/70 bg-white/75 p-3">
                              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">Missing bed data</p>
                              <p className="mt-1 text-[18px] font-extrabold text-amber-700">{formatCount(scanProgress?.missingBedDataCount ?? 0)}</p>
                            </div>
                          </>
                        ) : null}
                      </>
                    ) : null}
                  </div>

                  {isDetailScanMode ? (
                    <div className="mt-4 grid gap-3 lg:grid-cols-4">
                      <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Current table position</p>
                        <p className="mt-2 text-[20px] font-extrabold text-slate-950">
                          {currentDetailIndex ? formatCount(currentDetailIndex) + " / " + formatCount(detailProgressTotal ?? 0) : "-"}
                        </p>
                        <p className="mt-1 text-[12px] font-semibold text-slate-600">
                          {currentDetailPosition
                            ? "Portal page " + formatCount(currentDetailPosition.page) + (currentDetailPosition.totalPages ? " of " + formatCount(currentDetailPosition.totalPages) : "") + " - row " + formatCount(currentDetailPosition.row) + " of " + PORTAL_ROWS_PER_PAGE
                            : "Waiting for facility row"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Capture speed</p>
                        <p className="mt-2 text-[20px] font-extrabold text-slate-950">{formatSecondsPerFacility(averageCaptureSeconds)}</p>
                        <p className="mt-1 text-[12px] font-semibold text-slate-600">
                          {capturePerMinute ? capturePerMinute.toFixed(1) + " facilities/min" : "Calculating from live captures"}
                          {captureSampleSize ? " - " + captureSampleSize + " samples" : ""}
                        </p>
                      </div>
                      <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Estimated remaining</p>
                        <p className="mt-2 text-[20px] font-extrabold text-slate-950">{formatDurationFromSeconds(estimatedRemainingSeconds)}</p>
                        <p className="mt-1 text-[12px] font-semibold text-slate-600">
                          Active record: {formatDurationFromSeconds(captureTiming.activeSeconds)}
                          {scanProgress?.lastCaptureMs ? " - last capture " + formatSecondsPerFacility(scanProgress.lastCaptureMs / 1000) : speedAnalytics?.failedDueToTimeout ? " - timeouts " + formatCount(speedAnalytics.failedDueToTimeout) : captureTiming.lastSeconds ? " - last saved in " + formatSecondsPerFacility(captureTiming.lastSeconds) : ""}
                        </p>
                      </div>
                      <div className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
                        <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-blue-700">Fastest / slowest</p>
                        <p className="mt-2 text-[14px] font-extrabold text-slate-950">Fastest: {speedAnalytics?.fastestFacility ? formatSecondsPerFacility(speedAnalytics.fastestFacility.seconds) : "-"}</p>
                        <p className="mt-1 truncate text-[12px] font-semibold text-slate-600" title={speedAnalytics?.slowestFacility?.facilityName ?? undefined}>
                          Slowest: {speedAnalytics?.slowestFacility ? formatSecondsPerFacility(speedAnalytics.slowestFacility.seconds) + " - " + speedAnalytics.slowestFacility.facilityName : "-"}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {isDetailScanMode && scanProgress?.scanCompletionReport ? (
                    <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 shadow-sm">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-emerald-700">Fresh Scan Completion Report</p>
                          <p className="mt-1 text-[13px] font-semibold text-slate-700">Complete portal detail cache rebuild summary.</p>
                        </div>
                        <span className="rounded-full bg-white px-3 py-1 text-[11px] font-extrabold text-emerald-700 ring-1 ring-emerald-200">
                          Updated {formatCount(scanProgress.scanCompletionReport.facilitiesUpdated)}
                        </span>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                        {[
                          ["Facilities Updated", formatCount(scanProgress.scanCompletionReport.facilitiesUpdated)],
                          ["New Fields Captured", formatCount(scanProgress.scanCompletionReport.newFieldsCaptured)],
                          ["Failed Facilities", formatCount(scanProgress.scanCompletionReport.failedFacilities)],
                          ["Skipped Facilities", formatCount(scanProgress.scanCompletionReport.skippedFacilities)],
                          ["Total Scan Time", formatDurationFromSeconds(scanProgress.scanCompletionReport.totalScanTimeSeconds)],
                          ["Avg Capture", formatSecondsPerFacility(scanProgress.scanCompletionReport.averageCaptureTimeSeconds)],
                        ].map(([label, value]) => (
                          <div className="rounded-lg border border-white/80 bg-white/85 p-3" key={label}>
                            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
                            <p className="mt-1 text-[15px] font-extrabold text-slate-950">{value}</p>
                          </div>
                        ))}
                      </div>
                      {Object.keys(scanProgress.scanCompletionReport.missingFields).length ? (
                        <p className="mt-3 text-[12px] font-semibold text-amber-800">
                          Missing fields detected: {Object.entries(scanProgress.scanCompletionReport.missingFields).slice(0, 8).map(([field, count]) => field + " (" + count + ")").join(", ")}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {isDetailScanMode && scanProgress?.currentFacilityName ? (
                    <div className="mt-4 rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start gap-3">
                        <Loader2 className="mt-0.5 h-5 w-5 animate-spin text-blue-700" />
                        <div className="min-w-0">
                          <p className="text-[12px] font-extrabold uppercase tracking-[0.12em] text-blue-700">Capturing now</p>
                          <p className="mt-1 break-words text-[14px] font-extrabold text-slate-950">{scanProgress.currentFacilityName}</p>
                          {scanProgress.currentFacilityHefamaaId ? <p className="mt-1 text-[12px] font-semibold text-slate-500">{scanProgress.currentFacilityHefamaaId}</p> : null}
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {isDetailScanMode && scanProgress?.lastCapturedFacilityName ? (
                    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[13px] font-bold text-blue-900">
                      Last successful capture: {scanProgress.lastCapturedFacilityName}
                    </div>
                  ) : null}

                  {isDetailScanMode && scanProgress?.recentEvents?.length ? (
                    <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <h3 className="text-[13px] font-extrabold text-slate-950">Live Capture Activity</h3>
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-600">Real time</span>
                      </div>
                      <div className="max-h-72 space-y-2 overflow-auto pr-1">
                        {scanProgress.recentEvents.map((event) => (
                          <div className={["rounded-xl border p-3", scanEventTone(event.status)].join(" ")} key={event.id}>
                            <div className="flex items-start gap-3">
                              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/75">{scanEventIcon(event.status)}</span>
                              <div className="min-w-0 flex-1">
                                <p className="break-words text-[12px] font-extrabold leading-5">{event.message}</p>
                                <p className="mt-1 text-[11px] font-semibold opacity-75">
                                  {event.detailIndex && event.detailTotal ? event.detailIndex + " / " + event.detailTotal + " - " : ""}
                                  {event.category ? event.category + " - " : ""}
                                  {event.hefamaaId || event.at}
                                </p>
                                {event.error ? <p className="mt-1 break-words text-[11px] font-semibold opacity-80">{event.error}</p> : null}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-slate-700">
                        <span>Portal list indexing</span>
                        <span>{progressPercent(scanProgress?.scannedRecords, listProgressTotal).toFixed(0)}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/80">
                        <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: progressPercent(scanProgress?.scannedRecords, listProgressTotal).toFixed(1) + "%" }} />
                      </div>
                    </div>
                    {isDetailScanMode ? (
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[12px] font-bold text-slate-700">
                          <span>Facility detail capture</span>
                          <span>{progressPercent(scanProgress?.scannedDetails, detailProgressTotal).toFixed(0)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-white/80">
                          <div className="h-full rounded-full bg-blue-600 transition-all" style={{ width: progressPercent(scanProgress?.scannedDetails, detailProgressTotal).toFixed(1) + "%" }} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {summary ? (
                <div className="mt-5 grid gap-4 xl:grid-cols-3">
                  <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                    <h3 className="mb-4 flex items-center gap-2 text-[14px] font-extrabold text-slate-950"><BarChart3 className="h-4 w-4 text-blue-700" /> Top categories</h3>
                    <MiniBarList rows={topCategoryRows} />
                  </div>
                  <div className="rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
                    <h3 className="mb-4 flex items-center gap-2 text-[14px] font-extrabold text-slate-950"><BarChart3 className="h-4 w-4 text-blue-700" /> Workflow status</h3>
                    <MiniBarList rows={statusRows} tone="blue" />
                  </div>
                  <div className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
                    <h3 className="mb-4 flex items-center gap-2 text-[14px] font-extrabold text-slate-950"><BarChart3 className="h-4 w-4 text-amber-600" /> Records by year</h3>
                    <MiniBarList rows={yearlyRows} tone="amber" />
                  </div>
                </div>
              ) : null}

              {workflowSummary ? (
                <div className="mt-5 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(workflowSummary.statusCounts).map(([statusKey, count]) => (
                      <button
                        className={["rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md", selectedWorkflowStatus === statusKey ? "border-blue-300 bg-blue-50" : "border-slate-200 bg-white"].join(" ")}
                        key={statusKey}
                        onClick={() => setSelectedWorkflowStatus(selectedWorkflowStatus === statusKey ? null : statusKey as PortalWorkflowStatus)}
                        type="button"
                      >
                        <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                          {statusLabel(statusKey)}
                        </p>
                        <p className="mt-2 text-[20px] font-semibold text-slate-950">{formatCount(count)}</p>
                      </button>
                    ))}
                  </div>
                  {selectedWorkflowStatus ? (
                    <div className="overflow-hidden rounded-2xl border border-blue-100 bg-white shadow-sm">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-blue-50 px-4 py-3">
                        <div>
                          <p className="text-[13px] font-extrabold text-slate-950">{statusLabel(selectedWorkflowStatus)}</p>
                          <p className="text-[12px] font-semibold text-slate-500">{formatCount(selectedWorkflowFacilities.length)} portal-cache facilities</p>
                        </div>
                        <button className="rounded-lg border border-blue-200 bg-white px-3 py-2 text-[12px] font-bold text-blue-700" onClick={() => setSelectedWorkflowStatus(null)} type="button">Close</button>
                      </div>
                      <div className="max-h-96 overflow-auto">
                        <table className="min-w-full divide-y divide-slate-200 text-left text-[12px]">
                          <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-[0.08em] text-slate-500">
                            <tr>
                              <th className="px-3 py-2">Facility Name</th>
                              <th className="px-3 py-2">HEFA NO / Facility Code</th>
                              <th className="px-3 py-2">Category</th>
                              <th className="px-3 py-2">LGA</th>
                              <th className="px-3 py-2">Current Workflow Status</th>
                              <th className="px-3 py-2">Last Activity Date</th>
                              <th className="px-3 py-2">Last Scan Date</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {selectedWorkflowFacilities.slice(0, 300).map((facility) => (
                              <tr className="align-top" key={facility.id}>
                                <td className="px-3 py-2 font-bold text-slate-950">{facility.facilityName || "Unnamed facility"}</td>
                                <td className="px-3 py-2 text-blue-700">{facility.facilityCode || "-"}</td>
                                <td className="px-3 py-2 text-slate-700">{facility.category || "-"}</td>
                                <td className="px-3 py-2 text-slate-700">{facility.lga || "-"}</td>
                                <td className="px-3 py-2 text-slate-700">{facility.currentWorkflowStatusLabel}</td>
                                <td className="px-3 py-2 text-slate-700">{facility.lastActivityDate || "-"}</td>
                                <td className="px-3 py-2 text-slate-700">{facility.lastScanDate || "-"}</td>
                              </tr>
                            ))}
                            {!selectedWorkflowFacilities.length ? (
                              <tr><td className="px-3 py-5 text-slate-500" colSpan={7}>No facilities are currently counted under this workflow status.</td></tr>
                            ) : null}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ) : null}
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
                  className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-[13px] outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  onChange={(event) => setCacheQuery(event.target.value)}
                  placeholder="Facility name, HEF number, category, or status"
                  value={cacheQuery}
                />
                <button
                  className="flex h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
                  disabled={isSearchingCache}
                  type="submit"
                >
                  <Search className="h-4 w-4" />
                  {isSearchingCache ? "Searching..." : "Search"}
                </button>
              </form>
              {cachedRecords ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  <ExportDropdown align="left" compact query={cacheQuery} />
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
Quick Scan reads the full portal facility list for analytics, status counts, categories, yearly renewal counts, and exports. Full Detail Scan opens the current renewal year record when it exists, otherwise it uses the latest valid available portal year for facilities that are still completing an older renewal. It stores visible form/table details locally for offline AI answers, resumes from the detail cache after network or computer failure, and keeps annexes or branches separate when the portal exposes branch markers or different addresses. Neither scan writes to Google Sheets.
              </p>
            </div>
          </div>
        </div>
      {showFreshScanConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 py-6">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100">
                <RotateCcw className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-[18px] font-extrabold text-slate-950">Fresh Full Scan</h2>
                <p className="mt-2 text-[14px] leading-6 text-slate-700">
                  This will rescan all facilities from the beginning and update existing portal cache records. Continue?
                </p>
              </div>
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-xl border border-blue-100 bg-blue-50 p-4 text-[13px] font-semibold text-slate-700">
              <input
                checked={onlyMissingBeds}
                className="mt-1 h-4 w-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                onChange={(event) => setOnlyMissingBeds(event.target.checked)}
                type="checkbox"
              />
              <span>
                <span className="block font-extrabold text-slate-950">Only recapture missing bed fields</span>
                <span className="mt-1 block leading-5 text-slate-600">Open only facilities where admission beds, observation beds, or couches are missing or null.</span>
              </span>
            </label>
            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-[13px] font-extrabold text-slate-700 hover:bg-slate-50" onClick={() => setShowFreshScanConfirm(false)} type="button">
                Cancel
              </button>
              <button
                className="rounded-xl bg-indigo-600 px-4 py-2.5 text-[13px] font-extrabold text-white shadow-lg shadow-indigo-600/20 hover:bg-indigo-700"
                onClick={() => {
                  setShowFreshScanConfirm(false);
                  void scanPortal("fresh_full_scan", { onlyMissingBeds });
                }}
                type="button"
              >
                Start Fresh Full Scan
              </button>
            </div>
          </div>
        </div>
      ) : null}
      </section>
    </AppShell>
  );
}
