import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";

import { upsertPortalQaIndexDetail } from "@/lib/portalCacheQa";
import { writePortalScanSnapshot } from "@/lib/portalScanSnapshots";
import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";

type PortalStartupMetrics = {
  browserLaunchMs: number | null;
  portalNavigationMs: number | null;
  loginDetectionMs: number | null;
  facilityListReadyMs: number | null;
  lastUpdatedAt: string | null;
};

type PortalSession = {
  browser?: Browser | null;
  browserChannel?: string | null;
  context: BrowserContext;
  resourceBlockingReady?: boolean;
  page: Page;
  profileDir: string;
  storageStatePath?: string;
  openedAt?: string;
  lastActivity?: string;
  renewalSelection?: PortalRenewalSelection | null;
  lastSearchRows?: FacilitySearchResultRow[];
  lastSearchQuery?: string;
};

type SearchFacilityInput = {
  facilityName: string;
  openSelectedRecord?: boolean;
};

type OpenSearchResultInput = {
  rowIndex: number;
};

type VisibleFormField = {
  label: string;
  value: string;
  type: string;
};

type PortalProfileLock = {
  locked: boolean;
  pid?: number;
  raw?: string;
};

type ReleasePortalProfileLockOptions = {
  force?: boolean;
};

type FacilitySearchResultRow = {
  index: number;
  facilityName: string;
  hefamaaId: string;
  category: string;
  registrationStatus: string;
  recordDate?: string | null;
  renewalYear: number | null;
  visibleFields?: Record<string, string>;
  text: string;
  hasAction: boolean;
};

type PortalRenewalSelection = {
  currentRenewalYear: number;
  latestAvailableRenewalYear: number | null;
  selectedRenewalYear: number | null;
  renewalStatus: "current_year" | "latest_available_previous_year" | "unknown_year";
  selectedRecord: FacilitySearchResultRow;
  matches: FacilitySearchResultRow[];
  approvalEvidence: string[];
};

type PortalFacilityStatus =
  | "document_queried"
  | "payment_queried"
  | "upload_payment_pending_document_approval"
  | "payment_approved_pending_document_approval"
  | "document_approved_inspection_pending"
  | "inspection_report_upload_pending_approval"
  | "final_approval_pending"
  | "registration_approved"
  | "waiting_to_onboard"
  | "unknown_status";

type PortalApplicationType = "new_registration" | "renewal" | "unknown";
type PortalFacilityType = "new_registration" | "existing_facility" | "unknown";
type PortalScanStatus = "idle" | "running" | "completed" | "failed" | "cancelled";
type PortalScanMode = "quick" | "full" | "fresh_full_scan";
type PortalScanEventStatus = "capturing" | "captured" | "skipped" | "failed" | "info";

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
  status: PortalScanEventStatus;
};

type PortalScanSpeedAnalytics = {
  averageSecondsPerFacility: number | null;
  capturedSamples: number;
  estimatedSecondsRemaining: number | null;
  failedDueToTimeout: number;
  slowCaptures: number;
  fastestFacility: { facilityName: string; seconds: number } | null;
  slowestFacility: { facilityName: string; seconds: number } | null;
};

type PortalScanProgress = {
  completedAt: string | null;
  keepAwakeActive?: boolean;
  openTabsCount?: number;
  scanId?: string | null;
  stopRequested?: boolean;
  currentFacilityHefamaaId?: string | null;
  currentFacilityName?: string | null;
  currentPortalPage?: number | null;
  currentPortalRow?: number | null;
  detailTotal?: number;
  error?: string;
  failedDetails?: number;
  lastCaptureMs?: number | null;
  lastProcessedPortalPage?: number | null;
  lastProcessedPortalRow?: number | null;
  lastCapturedFacilityName?: string | null;
  message?: string;
  phase?: "starting" | "waiting_for_login" | "finding_facilities" | "indexing_list" | "capturing_details" | "completed";
  portalReportedRecords: number | null;
  scanMode?: PortalScanMode;
  recentEvents?: PortalScanEvent[];
  scannedDetails?: number;
  scannedPages: number;
  scannedRecords: number;
  skippedDetails?: number;
  slowCaptures?: number;
  remainingDetails?: number;
  recapturedDetails?: number;
  bedsCapturedCount?: number;
  missingBedDataCount?: number;
  onlyMissingBeds?: boolean;
  scanCompletionReport?: PortalScanCompletionReport;
  speedAnalytics?: PortalScanSpeedAnalytics;
  startedAt: string | null;
  status: PortalScanStatus;
};

export type PortalFacilityRecord = FacilitySearchResultRow & {
  applicationType: PortalApplicationType;
  normalizedStatus: PortalFacilityStatus;
  lastSeen: string;
  portalPageNumber?: number | null;
  portalRowNumber?: number | null;
};

type PortalStaffDetail = {
  matchedComplements: string[];
  rowIndex: number;
  tableIndex: number;
  text: string;
  values: string[];
};

type PortalBedDistribution = {
  admissionBeds: number | null;
  observationBeds: number | null;
  couches: number | null;
};

type PortalIdentificationDetails = {
  facilityName: string;
  facilityCode: string;
  portalFacilityId: string;
  facilitySector: string;
  facilityCategory: string;
  registrationStatus: string;
  registrationType: string;
  registrationRenewalYear: number | null;
  currentWorkflowStatus: string;
};

type PortalFacilityDetails = {
  cacNumber: string;
  multipleBranches: string;
  phoneNumber: string;
  emailAddress: string;
  physicalAddress: string;
  lga: string;
  lcda: string;
  closestLandmark: string;
  gpsCoordinates: string;
  buildingType: string;
  otherUsesOfPremises: string;
};

type PortalProprietorDetails = {
  proprietorName: string;
  proprietorAddress: string;
  nationality: string;
  occupation: string;
};

type PortalOperationsDetails = {
  openingTime: string;
  closingTime: string;
  dateOfEstablishment: string;
  ambulanceService: string;
  emergencyService: string;
  scopeOfServices: string;
};

type PortalFacilityResources = {
  toilets: string;
  waterSource: string;
  powerSource: string;
  humanWasteDisposal: string;
  refuseDisposal: string;
  medicalWasteDisposal: string;
  basicProtectiveItems: string;
};

type PortalOperatingOfficerDetails = {
  fullName: string;
  address: string;
  nationality: string;
  qualifications: string;
  registrationNumber: string;
  registrationYear: string;
  institution: string;
  regulatoryAuthority: string;
};

type PortalProfessionalStaffMember = {
  name: string;
  complement: string;
  employmentType: string;
  qualification: string;
  institution: string;
  yearQualified: string;
  registrationNumber: string;
  postQualification: string;
  text: string;
  values: string[];
};

type PortalNonProfessionalStaff = {
  hospitalAttendants: number | null;
  administrativeStaff: number | null;
  securityStaff: number | null;
  others: string;
};

type PortalDocumentStatus = {
  name: string;
  status: string;
  available: boolean | null;
  text: string;
};

type PortalWorkflowDetails = {
  queries: string;
  documentQuery: string;
  uploadPaymentDocumentApprovalPending: string;
  paymentApprovedDocumentApprovalPending: string;
  documentApprovedInspectionReportPending: string;
  inspectionReportUploadInspectionApprovalPending: string;
  finalApprovalPending: string;
  registrationApprovedDate: string;
  lastActivityDate: string;
};

type PortalScanCompletionReport = {
  averageCaptureTimeSeconds: number | null;
  failedFacilities: number;
  facilitiesUpdated: number;
  missingFields: Record<string, number>;
  newFieldsCaptured: number;
  skippedFacilities: number;
  totalScanTimeSeconds: number | null;
};

export type PortalFacilityDetailRecord = {
  admissionBeds: number | null;
  applicationType: PortalApplicationType;
  bedDistribution: PortalBedDistribution;
  bodyText: string;
  couches: number | null;
  cacheKey: string;
  capturedAt: string;
  category: string;
  facilityName: string;
  documents?: PortalDocumentStatus[];
  facilityDetails?: PortalFacilityDetails;
  facilityResources?: PortalFacilityResources;
  identification?: PortalIdentificationDetails;
  fieldIndex: Record<string, string>;
  formFields: VisibleFormField[];
  hefamaaId: string;
  normalizedStatus: PortalFacilityStatus;
  nonProfessionalStaff?: PortalNonProfessionalStaff;
  operatingOfficer?: PortalOperatingOfficerDetails;
  operations?: PortalOperationsDetails;
  observationBeds: number | null;
  recordDate?: string | null;
  professionalStaff?: PortalProfessionalStaffMember[];
  proprietorDetails?: PortalProprietorDetails;
  registrationStatus: string;
  renewalYear: number | null;
  sourceRecord: PortalFacilityRecord;
  staffComplement: Record<string, number>;
  staffDetails?: PortalStaffDetail[];
  tables: string[][][];
  text: string;
  url: string;
  visibleFields: Record<string, string>;
  workflow?: PortalWorkflowDetails;
  captureWarnings?: string[];
  scanMode?: PortalScanMode;
  recapturedAt?: string;
  registrationApprovedAt?: string | null;
  approvalMonth?: string | null;
  approvalYear?: string | null;
  approvalDateSource?: string | null;
  approvalDateWarning?: string | null;
};

type JsonFileCache<T> = {
  mtimeMs: number;
  path: string;
  value: T;
};

let portalFacilityListCache: JsonFileCache<PortalFacilityRecord[]> | null = null;
let portalFacilityDetailsCache: JsonFileCache<PortalFacilityDetailRecord[]> | null = null;
let portalFacilityExportCache: (JsonFileCache<PortalFacilityRecord[]> & { detailsMtimeMs: number; detailsPath: string }) | null = null;

function fileMtimeMs(cachePath: string) {
  try {
    return existsSync(cachePath) ? statSync(cachePath).mtimeMs : 0;
  } catch {
    return 0;
  }
}

type PortalFacilitySummary = {
  totalFacilities: number;
  totalPortalRecords: number;
  portalReportedRecords: number | null;
  categoryCounts: Array<{ category: string; count: number }>;
  categoryPortalRecordCounts: Array<{ category: string; count: number }>;
  detailLastCaptured: string | null;
  detailRecords: number;
  applicationTypeCounts: Record<PortalApplicationType, number>;
  facilityTypeCounts: Record<PortalFacilityType, number>;
  statusCounts: Record<PortalFacilityStatus, number>;
  scanProgress: PortalScanProgress;
  lastScanned: string | null;
  monthlyRegistrationCounts: Array<{ month: string; count: number }>;
  monthlyNewRegistrationCounts: Array<{ month: string; count: number }>;
  monthlyRenewalCounts: Array<{ month: string; count: number }>;
  yearlyPortalRecordCounts: Array<{ year: number; count: number }>;
  yearlyRenewalCounts: Array<{ year: number; count: number }>;
  note?: string;
};

let portalFacilitySummaryCache: (JsonFileCache<PortalFacilitySummary> & { detailsMtimeMs: number; detailsPath: string }) | null = null;

export function getFastPortalFacilitySummary() {
  const cached = portalFacilitySummaryCache?.value;

  if (cached) {
    return {
      ...cached,
      detailRecords: Math.max(cached.detailRecords, portalRuntime.scanProgress.scannedDetails ?? 0),
      portalReportedRecords: portalRuntime.scanProgress.portalReportedRecords ?? cached.portalReportedRecords,
      scanProgress: portalRuntime.scanProgress,
    } satisfies PortalFacilitySummary;
  }

  return {
    totalFacilities: 0,
    totalPortalRecords: 0,
    portalReportedRecords: portalRuntime.scanProgress.portalReportedRecords ?? null,
    categoryCounts: [],
    categoryPortalRecordCounts: [],
    detailLastCaptured: null,
    detailRecords: portalRuntime.scanProgress.scannedDetails ?? 0,
    applicationTypeCounts: {
      new_registration: 0,
      renewal: 0,
      unknown: 0,
    },
    facilityTypeCounts: {
      new_registration: 0,
      existing_facility: 0,
      unknown: 0,
    },
    statusCounts: {
      document_queried: 0,
      payment_queried: 0,
      upload_payment_pending_document_approval: 0,
      payment_approved_pending_document_approval: 0,
      document_approved_inspection_pending: 0,
      inspection_report_upload_pending_approval: 0,
      final_approval_pending: 0,
      registration_approved: 0,
      waiting_to_onboard: 0,
      unknown_status: 0,
    },
    scanProgress: portalRuntime.scanProgress,
    lastScanned: null,
    monthlyRegistrationCounts: [],
    monthlyNewRegistrationCounts: [],
    monthlyRenewalCounts: [],
    yearlyPortalRecordCounts: [],
    yearlyRenewalCounts: [],
    note: "Portal scan stop acknowledged. Cached summary will refresh after the scan worker exits.",
  } satisfies PortalFacilitySummary;
}

type ScanControllerState = {
  scanId: string | null;
  scanRunning: boolean;
  stopRequested: boolean;
  scanMode: PortalScanMode | null;
  currentFacility: string | null;
  capturedCount: number;
  failedCount: number;
  skippedCount: number;
  startedAt: string | null;
  stoppedAt: string | null;
};

type PortalRuntimeStore = {
  cleanupHooksAttached: boolean;
  closingSession: Promise<void> | null;
  dedicatedBrowserPid?: number;
  keepAwakePid?: number;
  hostResolveCheckedAt: number;
  openingSession: Promise<PortalSession> | null;
  scanPromise: Promise<void> | null;
  scanProgress: PortalScanProgress;
  scanController: ScanControllerState;
  scanStopRequested: boolean;
  session: PortalSession | null;
  startupMetrics: PortalStartupMetrics;
};

const globalPortalRuntime = globalThis as typeof globalThis & {
  __hefamaaPortalRuntime?: PortalRuntimeStore;
};

const portalRuntime: PortalRuntimeStore =
  globalPortalRuntime.__hefamaaPortalRuntime ??
  (globalPortalRuntime.__hefamaaPortalRuntime = {
    cleanupHooksAttached: false,
    closingSession: null,
    keepAwakePid: undefined,
    hostResolveCheckedAt: 0,
    openingSession: null,
    scanPromise: null,
    scanController: {
      scanId: null,
      scanRunning: false,
      stopRequested: false,
      scanMode: null,
      currentFacility: null,
      capturedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      startedAt: null,
      stoppedAt: null,
    },
    scanStopRequested: false,
    startupMetrics: {
      browserLaunchMs: null,
      portalNavigationMs: null,
      loginDetectionMs: null,
      facilityListReadyMs: null,
      lastUpdatedAt: null,
    },
    scanProgress: {
      completedAt: null,
      currentFacilityHefamaaId: null,
      currentFacilityName: null,
      detailTotal: 0,
      failedDetails: 0,
      keepAwakeActive: false,
      lastCapturedFacilityName: null,
      portalReportedRecords: null,
      recentEvents: [],
      scanMode: "quick",
      scannedDetails: 0,
      scannedPages: 0,
      scannedRecords: 0,
      skippedDetails: 0,
      speedAnalytics: {
        averageSecondsPerFacility: null,
        capturedSamples: 0,
        estimatedSecondsRemaining: null,
        failedDueToTimeout: 0,
        slowCaptures: 0,
        fastestFacility: null,
        slowestFacility: null,
      },
      startedAt: null,
      status: "idle",
    },
    session: null,
  });

// Next.js hot reload can preserve the runtime object after new fields are added.
portalRuntime.startupMetrics ??= {
  browserLaunchMs: null,
  portalNavigationMs: null,
  loginDetectionMs: null,
  facilityListReadyMs: null,
  lastUpdatedAt: null,
};
portalRuntime.closingSession ??= null;
portalRuntime.keepAwakePid ??= undefined;
portalRuntime.scanProgress.keepAwakeActive ??= Boolean(portalRuntime.keepAwakePid && isProcessRunning(portalRuntime.keepAwakePid));
portalRuntime.openingSession ??= null;
portalRuntime.scanPromise ??= null;
portalRuntime.scanController ??= {
  scanId: null,
  scanRunning: false,
  stopRequested: false,
  scanMode: null,
  currentFacility: null,
  capturedCount: 0,
  failedCount: 0,
  skippedCount: 0,
  startedAt: null,
  stoppedAt: null,
};
portalRuntime.scanStopRequested ??= false;
portalRuntime.scanProgress ??= {
  completedAt: null,
  currentFacilityHefamaaId: null,
  currentFacilityName: null,
  detailTotal: 0,
  failedDetails: 0,
  lastCapturedFacilityName: null,
  message: undefined,
  phase: "starting",
  portalReportedRecords: null,
  recentEvents: [],
  scanMode: "quick",
  scannedDetails: 0,
  scannedPages: 0,
  scannedRecords: 0,
  skippedDetails: 0,
  startedAt: null,
  status: "idle",
};
portalRuntime.scanProgress.currentFacilityHefamaaId ??= null;
portalRuntime.scanProgress.currentFacilityName ??= null;
portalRuntime.scanProgress.failedDetails ??= 0;
portalRuntime.scanProgress.lastCapturedFacilityName ??= null;
portalRuntime.scanProgress.recentEvents ??= [];
portalRuntime.scanProgress.skippedDetails ??= 0;
portalRuntime.scanProgress.speedAnalytics ??= {
  averageSecondsPerFacility: null,
  capturedSamples: 0,
  estimatedSecondsRemaining: null,
  failedDueToTimeout: 0,
  slowCaptures: 0,
  fastestFacility: null,
  slowestFacility: null,
};

function scanErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown portal scan error");
}

function createPortalScanEvent(input: Omit<PortalScanEvent, "at" | "id">): PortalScanEvent {
  return {
    ...input,
    at: new Date().toISOString(),
    id: Date.now() + "-" + Math.random().toString(36).slice(2),
  };
}

function updatePortalScanProgress(patch: Partial<PortalScanProgress>) {
  portalRuntime.scanProgress = {
    ...portalRuntime.scanProgress,
    ...patch,
  };
  portalFacilitySummaryCache = null;
}

function appendPortalScanEvent(input: Omit<PortalScanEvent, "at" | "id">) {
  const event = createPortalScanEvent(input);
  updatePortalScanProgress({
    recentEvents: [event, ...(portalRuntime.scanProgress.recentEvents ?? [])].slice(0, 18),
  });
  return event;
}

function createScanId(mode: PortalScanMode) {
  return mode + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

function updateScanController(patch: Partial<ScanControllerState>) {
  portalRuntime.scanController = {
    ...portalRuntime.scanController,
    ...patch,
  };
}

function syncScanControllerProgress() {
  updatePortalScanProgress({
    scanId: portalRuntime.scanController.scanId,
    stopRequested: isGracefulStopRequested(),
  });
}

async function updateOpenTabsCount(context?: BrowserContext | null) {
  const count = context ? usablePages(context).length : getSession()?.context ? usablePages(getSession()!.context).length : 0;
  updatePortalScanProgress({ openTabsCount: count });
  return count;
}

function portalRecordDisplayName(record: Pick<PortalFacilityRecord, "facilityName" | "hefamaaId">) {
  return cleanPortalText(record.facilityName) || cleanPortalText(record.hefamaaId) || "Unnamed facility";
}

function isPortalScanCancellationError(error: unknown) {
  return portalRuntime.scanStopRequested || /scan cancelled|scan stopped|cancelled by user/i.test(scanErrorMessage(error));
}

function positiveEnvInt(name: string, fallback: number, min = 1, max = 120_000) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? Math.min(Math.floor(value), max) : fallback;
}

function facilityCaptureTimeoutMs() {
  return positiveEnvInt("FACILITY_CAPTURE_TIMEOUT_MS", 2_000, 500, 60_000);
}

function facilityNavigationTimeoutMs() {
  return positiveEnvInt("FACILITY_NAVIGATION_TIMEOUT_MS", 8_000, 2_000, 60_000);
}

function facilityRetryLimit() {
  return positiveEnvInt("FACILITY_RETRY_LIMIT", 1, 0, 5);
}

function facilitySlowCaptureThresholdMs() {
  return positiveEnvInt("FACILITY_SLOW_CAPTURE_THRESHOLD_MS", 2_000, 500, 60_000);
}

function portalScanStopSignalPath() {
  return configuredRuntimeFile("HEFAMAA_PORTAL_SCAN_STOP_SIGNAL", "portal-scan-stop-signal.json");
}

function clearPortalScanStopSignal() {
  rmSync(portalScanStopSignalPath(), { force: true });
}

function writePortalScanStopSignal(reason = "SCAN_STOPPED_BY_USER") {
  const file = portalScanStopSignalPath();
  ensureRuntimeDataDirForFile(file);
  writeFileSync(file, JSON.stringify({ reason, requestedAt: new Date().toISOString() }, null, 2), "utf8");
}

function isPortalScanStopSignalRequested() {
  return existsSync(portalScanStopSignalPath());
}

function isGracefulStopRequested() {
  return portalRuntime.scanController.stopRequested || isPortalScanStopSignalRequested();
}

type PortalScanRecoveryRecord = {
  category?: string;
  errorStack?: string;
  facilityName: string;
  failureReason: string;
  hefamaaId?: string;
  lastRetryTime?: string | null;
  portalPageNumber?: number | null;
  portalRowNumber?: number | null;
  retryAttempts: number;
  status: "failed" | "manual_review" | "skipped";
  timestamp: string;
};

type PortalScanRecoveryFile = { failed: PortalScanRecoveryRecord[]; skipped: PortalScanRecoveryRecord[]; updatedAt: string };

function portalScanRecoveryQueuePath() {
  return configuredRuntimeFile("HEFAMAA_PORTAL_SCAN_RECOVERY_QUEUE", "portal-scan-recovery-queue.json");
}

function readPortalScanRecoveryQueue(): PortalScanRecoveryFile {
  const file = portalScanRecoveryQueuePath();
  if (!existsSync(file)) return { failed: [], skipped: [], updatedAt: new Date().toISOString() };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PortalScanRecoveryFile>;
    return {
      failed: Array.isArray(parsed.failed) ? parsed.failed : [],
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
      updatedAt: cleanPortalText(parsed.updatedAt) || new Date().toISOString(),
    };
  } catch {
    return { failed: [], skipped: [], updatedAt: new Date().toISOString() };
  }
}

function writePortalScanRecoveryQueue(queue: PortalScanRecoveryFile) {
  const file = portalScanRecoveryQueuePath();
  ensureRuntimeDataDirForFile(file);
  writeFileSync(file, JSON.stringify({ ...queue, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}

function recoveryKey(record: Pick<PortalScanRecoveryRecord, "facilityName" | "hefamaaId" | "category">) {
  return [record.hefamaaId, record.facilityName, record.category].map(cleanPortalText).join("|").toLowerCase();
}

function recordPortalScanRecovery(kind: "failed" | "skipped", record: PortalScanRecoveryRecord) {
  const queue = readPortalScanRecoveryQueue();
  const bucket = kind === "failed" ? queue.failed : queue.skipped;
  const key = recoveryKey(record);
  const existingIndex = bucket.findIndex((item) => recoveryKey(item) === key);
  const nextRecord = existingIndex >= 0
    ? { ...bucket[existingIndex], ...record, retryAttempts: Math.max(bucket[existingIndex].retryAttempts ?? 0, record.retryAttempts ?? 0) }
    : record;
  if (existingIndex >= 0) bucket[existingIndex] = nextRecord;
  else bucket.unshift(nextRecord);
  queue.failed = queue.failed.slice(0, 2000);
  queue.skipped = queue.skipped.slice(0, 2000);
  writePortalScanRecoveryQueue(queue);
}

function detailPositionForIndex(detailIndex: number) {
  if (!detailIndex || detailIndex < 1) return { portalPageNumber: null, portalRowNumber: null };
  return {
    portalPageNumber: Math.ceil(detailIndex / 100),
    portalRowNumber: ((detailIndex - 1) % 100) + 1,
  };
}

function classifyDetailFailureReason(error: unknown, durationMs: number, timeoutMs: number) {
  const message = scanErrorMessage(error);
  if (durationMs > timeoutMs || /timeout|timed out/i.test(message)) return "Portal timeout";
  if (/target closed|browser closed|page closed/i.test(message)) return "Browser crashed";
  if (/navigation/i.test(message)) return "Navigation error";
  if (/selector|locator|element|dom/i.test(message)) return "Missing DOM element";
  if (/network|fetch|socket|dns/i.test(message)) return "Network timeout";
  return "Playwright exception";
}

function updateSpeedAnalyticsFromTimings(timings: Array<{ facilityName: string; seconds: number }>, failedDueToTimeout: number, remaining: number, slowCaptures = 0) {
  if (!timings.length) {
    return {
      averageSecondsPerFacility: null,
      capturedSamples: 0,
      estimatedSecondsRemaining: null,
      failedDueToTimeout,
      slowCaptures,
      fastestFacility: null,
      slowestFacility: null,
    } satisfies PortalScanSpeedAnalytics;
  }

  const average = timings.reduce((sum, item) => sum + item.seconds, 0) / timings.length;
  const fastest = timings.reduce((best, item) => item.seconds < best.seconds ? item : best, timings[0]);
  const slowest = timings.reduce((worst, item) => item.seconds > worst.seconds ? item : worst, timings[0]);
  return {
    averageSecondsPerFacility: Number(average.toFixed(2)),
    capturedSamples: timings.length,
    estimatedSecondsRemaining: Number((average * Math.max(0, remaining)).toFixed(0)),
    failedDueToTimeout,
    slowCaptures,
    fastestFacility: { facilityName: fastest.facilityName, seconds: Number(fastest.seconds.toFixed(2)) },
    slowestFacility: { facilityName: slowest.facilityName, seconds: Number(slowest.seconds.toFixed(2)) },
  } satisfies PortalScanSpeedAnalytics;
}

function isPortalTargetClosedError(error: unknown) {
  return /target page, context or browser has been closed|page, context or browser has been closed|browser has been closed|target closed/i.test(scanErrorMessage(error));
}

function throwIfPortalScanStopped() {
  if (portalRuntime.scanStopRequested) {
    throw new Error("Portal scan cancelled by user.");
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }

    await delay(50);
  }

  return !isProcessRunning(pid);
}

async function terminateProcess(pid: number | undefined, timeoutMs = 3_000) {
  if (!pid || !isProcessRunning(pid)) {
    return;
  }

  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return;
  }

  if (await waitForProcessExit(pid, timeoutMs)) {
    return;
  }

  try {
    process.kill(pid, "SIGKILL");
  } catch {
    return;
  }

  await waitForProcessExit(pid, timeoutMs);
}

function portalKeepAwakeEnabled() {
  return process.platform === "darwin" && !/^(0|false|no)$/i.test(process.env.HEFAMAA_PORTAL_KEEP_AWAKE?.trim() ?? "true");
}

function startPortalScanKeepAwake(mode: PortalScanMode) {
  if ((mode !== "full" && mode !== "fresh_full_scan") || !portalKeepAwakeEnabled()) {
    updatePortalScanProgress({ keepAwakeActive: false });
    return;
  }

  const existingPid = portalRuntime.keepAwakePid;
  if (existingPid && isProcessRunning(existingPid)) {
    updatePortalScanProgress({ keepAwakeActive: true });
    return;
  }
  portalRuntime.keepAwakePid = undefined;

  try {
    // A detail scan is long-running. Keep macOS awake so screen lock or idle sleep
    // does not freeze Chromium/CDP midway through a resumable capture.
    const child = spawn("caffeinate", ["-dimsu"], { detached: true, stdio: "ignore" });
    child.unref();
    portalRuntime.keepAwakePid = child.pid;
    updatePortalScanProgress({ keepAwakeActive: Boolean(child.pid) });
    child.once("exit", () => {
      if (portalRuntime.keepAwakePid === child.pid) {
        portalRuntime.keepAwakePid = undefined;
        updatePortalScanProgress({ keepAwakeActive: false });
      }
    });
    appendPortalScanEvent({
      message: mode === "fresh_full_scan" ? "Mac keep-awake guard started for Fresh Full Scan." : "Mac keep-awake guard started for Full Detail Scan.",
      status: "info",
    });
  } catch (error) {
    updatePortalScanProgress({ keepAwakeActive: false });
    appendPortalScanEvent({
      error: scanErrorMessage(error),
      message: "Unable to start the macOS keep-awake guard. The scan can continue, but system sleep may pause it.",
      status: "failed",
    });
  }
}

async function stopPortalScanKeepAwake() {
  const pid = portalRuntime.keepAwakePid;
  portalRuntime.keepAwakePid = undefined;
  updatePortalScanProgress({ keepAwakeActive: false });
  if (!pid) return;
  await terminateProcess(pid, 1_500);
  appendPortalScanEvent({
    message: "Mac keep-awake guard stopped.",
    status: "info",
  });
}

async function persistPortalStorageState(session: PortalSession) {
  const storageStatePath = session.storageStatePath ?? getPortalStorageStatePath();
  ensureRuntimeDataDirForFile(storageStatePath);
  await session.context.storageState({ path: storageStatePath }).catch(() => undefined);
}

function portalStorageStateExists() {
  return existsSync(getPortalStorageStatePath());
}

function portalStorageStateMtime() {
  const file = getPortalStorageStatePath();
  try {
    return existsSync(file) ? new Date(statSync(file).mtimeMs).toISOString() : null;
  } catch {
    return null;
  }
}

async function hydratePortalStorageState(context: BrowserContext, page: Page) {
  const file = getPortalStorageStatePath();
  if (!existsSync(file)) return false;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as {
      cookies?: Parameters<BrowserContext["addCookies"]>[0];
      origins?: Array<{ origin: string; localStorage?: Array<{ name: string; value: string }> }>;
    };
    if (Array.isArray(parsed.cookies) && parsed.cookies.length) {
      await context.addCookies(parsed.cookies).catch(() => undefined);
    }
    if (Array.isArray(parsed.origins) && parsed.origins.length) {
      await page.addInitScript((origins) => {
        const currentOrigin = window.location.origin;
        const originState = origins.find((item) => item.origin === currentOrigin);
        for (const item of originState?.localStorage ?? []) {
          try {
            window.localStorage.setItem(item.name, item.value);
          } catch {
            // Ignore storage write failures; portal can still use cookies from the same saved state.
          }
        }
      }, parsed.origins).catch(() => undefined);
    }
    return true;
  } catch (error) {
    console.warn("[portal/session] saved portal session could not be loaded", scanErrorMessage(error));
    return false;
  }
}

function updateStartupMetric(key: keyof Omit<PortalStartupMetrics, "lastUpdatedAt">, startedAt: number) {
  const duration = Math.max(0, Date.now() - startedAt);
  portalRuntime.startupMetrics[key] = duration;
  portalRuntime.startupMetrics.lastUpdatedAt = new Date().toISOString();
  console.info("[portal/performance] " + key, duration + "ms");
}

async function setupPortalResourceBlocking(session: PortalSession) {
  if (session.resourceBlockingReady) return;
  session.resourceBlockingReady = true;
  await session.context.route("**/*", async (route) => {
    const request = route.request();
    const type = request.resourceType();
    const url = request.url();
    if (["image", "font", "media"].includes(type)) return route.abort().catch(() => undefined);
    if (type === "script" && /google-analytics|googletagmanager|facebook|doubleclick|hotjar|clarity|analytics/i.test(url)) {
      return route.abort().catch(() => undefined);
    }
    return route.continue().catch(() => undefined);
  }).catch(() => {
    session.resourceBlockingReady = false;
  });
}

async function savePortalSessionState() {
  const session = getSession();
  if (!session || session.page.isClosed()) {
    throw new Error("No active portal browser session is available to save.");
  }
  await persistPortalStorageState(session);
  return {
    saved: true,
    storageStateSaved: true,
    lastLoginSavedAt: portalStorageStateMtime(),
    note: "Portal session saved. Future scans will reuse this controlled browser session until the portal expires it.",
  };
}

export async function savePortalSession() {
  return savePortalSessionState();
}

export async function clearPortalSession() {
  const file = getPortalStorageStatePath();
  rmSync(file, { force: true });
  return {
    cleared: true,
    storageStateSaved: false,
    lastLoginSavedAt: null,
    note: "Saved portal session cleared. Open the portal browser and log in again to create a fresh session.",
  };
}

export async function reconnectPortalSession() {
  const session = await openPortalTab({ fastOpen: true });
  const loginStartedAt = Date.now();
  const loggedIn = await detectLoggedInPage(session.page);
  updateStartupMetric("loginDetectionMs", loginStartedAt);
  if (loggedIn) await persistPortalStorageState(session);
  return {
    reconnected: true,
    loggedIn,
    sessionState: loggedIn ? "active" : "expired",
    currentPage: session.page.url(),
    lastLoginSavedAt: portalStorageStateMtime(),
    note: loggedIn ? "Portal session reconnected and is active." : "Portal session expired. Please login again inside the portal browser.",
  };
}

async function closePortalSession(session: PortalSession, timeoutMs = 8_000) {
  const dedicatedBrowserPid = portalRuntime.dedicatedBrowserPid ?? getPortalProfileLock(session.profileDir).pid;

  await withTimeout(
    (async () => {
      await persistPortalStorageState(session);
      await session.context.close().catch(() => undefined);
      await session.browser?.close().catch(() => undefined);
      await terminateProcess(dedicatedBrowserPid, 3_000);
      portalRuntime.dedicatedBrowserPid = undefined;
    })(),
    timeoutMs,
    "Timed out closing the HEFAMAA portal browser session.",
  ).catch(() => undefined);
}

function getSession() {
  return portalRuntime.session;
}

function setSession(nextSession: PortalSession | null) {
  portalRuntime.session = nextSession;
}

function getPortalUrl() {
  const configuredUrl = process.env.HEFAMAA_PORTAL_URL?.trim() || "https://portal.hefamaaportal.com.ng/";
  const withProtocol = /^https?:\/\//i.test(configuredUrl) ? configuredUrl : `https://${configuredUrl}`;

  try {
    return new URL(withProtocol).toString();
  } catch {
    throw new Error(`Invalid HEFAMAA_PORTAL_URL: ${configuredUrl}`);
  }
}

export function getConfiguredPortalUrl() {
  return getPortalUrl();
}

function getPortalLoginUrl() {
  return new URL("/login", getPortalUrl()).toString();
}

function getPortalEntryUrls() {
  return Array.from(new Set([getPortalUrl(), getPortalLoginUrl()]));
}

async function verifyPortalHostResolves() {
  const now = Date.now();

  if (now - portalRuntime.hostResolveCheckedAt < 5 * 60_000) {
    return;
  }

  const hostname = new URL(getPortalUrl()).hostname;

  await withTimeout(
    lookup(hostname),
    2_500,
    `Could not resolve ${hostname}. Check the internet connection or DNS, then try Open HEFAMAA Portal again.`,
  );
  portalRuntime.hostResolveCheckedAt = now;
}

function getPortalProfileDir() {
  return configuredRuntimeFile("HEFAMAA_PORTAL_PROFILE_DIR", "portal-profile");
}

function getPortalStorageStatePath() {
  return configuredRuntimeFile("HEFAMAA_PORTAL_STORAGE_STATE", "portal-storage-state.json");
}

function profileName(profileDir: string) {
  return path.relative(process.cwd(), profileDir) || profileDir;
}

function storageStateName(storageStatePath: string) {
  return path.relative(process.cwd(), storageStatePath) || storageStatePath;
}

function getRecoveryPortalProfileDir(profileDir = getPortalProfileDir()) {
  return profileDir + "-recovery";
}

function getPortalBrowserChannel() {
  const configuredChannel = process.env.HEFAMAA_PORTAL_BROWSER_CHANNEL?.trim();

  if (!configuredChannel) {
    return undefined;
  }

  return /^(bundled|playwright|chromium)$/i.test(configuredChannel) ? undefined : configuredChannel;
}

function shouldRunPortalHeadless() {
  const configured = process.env.HEFAMAA_PORTAL_HEADLESS?.trim();
  if (configured) return /^(1|true|yes)$/i.test(configured);

  // Local staff still get a visible browser by default. Hosted Linux environments
  // such as Render run without a desktop display, so the scanner must be headless.
  return process.platform === "linux" && Boolean(process.env.RENDER);
}

function browserChannelLabel(channel: string | undefined | null) {
  if (channel) return channel;
  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const executable = process.env.HEFAMAA_PORTAL_BROWSER_EXECUTABLE?.trim() || (process.env.NODE_ENV === "production" ? "" : macChrome);
  if (executable && existsSync(/*turbopackIgnore: true*/ executable)) return "Controlled Portal Browser";
  return "Controlled Portal Browser";
}

function getPortalDebuggingPort() {
  const configuredPort = Number(process.env.HEFAMAA_PORTAL_DEBUG_PORT);
  return Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535 ? configuredPort : 9333;
}

function getPortalChromeExecutable(defaultExecutable: string) {
  const configuredExecutable = process.env.HEFAMAA_PORTAL_BROWSER_EXECUTABLE?.trim();
  if (configuredExecutable) return configuredExecutable;

  const forceBundled = /^(1|true|yes)$/i.test(process.env.HEFAMAA_PORTAL_USE_BUNDLED_CHROMIUM?.trim() ?? "");
  if (forceBundled) return defaultExecutable;

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return process.env.NODE_ENV !== "production" && existsSync(/*turbopackIgnore: true*/ macChrome) ? macChrome : defaultExecutable;
}

async function portalDebuggingEndpointReady(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(750) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForPortalDebuggingEndpoint(port: number, timeoutMs = 45_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await portalDebuggingEndpointReady(port)) return;
    await delay(200);
  }

  throw new Error(`Timed out waiting for the dedicated HEFAMAA portal browser on local debugging port ${port}.`);
}

function getPortalProfileLock(profileDir = getPortalProfileDir()): PortalProfileLock {
  const lockPath = path.join(/*turbopackIgnore: true*/ profileDir, "SingletonLock");

  try {
    const raw = readlinkSync(lockPath);
    const pidMatch = raw.match(/-(\d+)$/);
    const pid = pidMatch ? Number(pidMatch[1]) : undefined;

    if (pid && Number.isInteger(pid)) {
      try {
        process.kill(pid, 0);
        return { locked: true, pid, raw };
      } catch {
        return { locked: false, raw };
      }
    }

    return { locked: Boolean(raw), raw };
  } catch {
    return { locked: false };
  }
}

function portalProfileLockedError(lock: PortalProfileLock, profileDir: string) {
  const pidText = lock.pid ? ` process ${lock.pid}` : "";

  return new Error(
    `Portal browser session is already open${pidText}. Close the existing controlled portal browser session that uses ${profileName(
      profileDir,
    )}, then click Open HEFAMAA Portal again.`,
  );
}

function isTimeoutError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Timeout|Timed out/i.test(message);
}

function clearPortalSingletonFiles(profileDir: string) {
  for (const lockFile of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    rmSync(path.join(/*turbopackIgnore: true*/ profileDir, lockFile), { force: true });
  }
}

function hasPortalSingletonFiles(profileDir: string) {
  return ["SingletonLock", "SingletonSocket", "SingletonCookie"].some((lockFile) => existsSync(path.join(/*turbopackIgnore: true*/ profileDir, lockFile)));
}

async function terminateChromeProcessesForProfile(profileDir: string) {
  await new Promise<void>((resolve) => {
    const child = spawn("pkill", ["-f", "--user-data-dir=" + profileDir], { stdio: "ignore" });
    const timer = setTimeout(resolve, 1_500);
    child.once("error", () => {
      clearTimeout(timer);
      resolve();
    });
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function resetStuckDedicatedPortalBrowser(profileDir: string) {
  const lock = getPortalProfileLock(profileDir);
  if (lock.pid) {
    await terminateProcess(lock.pid, 2_000);
  }

  // Chrome can survive a sleep/wake crash without leaving a reliable SingletonLock PID.
  // Kill only Chrome processes using this exact HEFAMAA profile before reopening it.
  await terminateChromeProcessesForProfile(profileDir);

  const afterTermLock = getPortalProfileLock(profileDir);
  if (!afterTermLock.locked) {
    clearPortalSingletonFiles(profileDir);
  }

  portalRuntime.dedicatedBrowserPid = undefined;
}

export async function releasePortalProfileLock(options: ReleasePortalProfileLockOptions = {}) {
  const currentSession = getSession();

  if (currentSession) {
    await closePortalSession(currentSession);
    setSession(null);
  }

  const profileDir = getPortalProfileDir();
  const lock = getPortalProfileLock(profileDir);

  if (lock.locked && lock.pid) {
    if (!options.force) {
      return {
        released: false,
        profileName: profileName(profileDir),
        profileLocked: true,
        profileLockPid: lock.pid,
        note: `Portal profile is locked by process ${lock.pid}. Use force release only if this is the old HEFAMAA portal browser window.`,
      };
    }

    await terminateProcess(lock.pid, 2_000);

    const afterTermLock = getPortalProfileLock(profileDir);
    if (afterTermLock.locked && afterTermLock.pid) {
      await terminateProcess(afterTermLock.pid, 2_000);
    }
  }

  const nextLock = getPortalProfileLock(profileDir);

  if (!nextLock.locked) {
    clearPortalSingletonFiles(profileDir);
  }

  const finalLock = getPortalProfileLock(profileDir);

  return {
    released: !finalLock.locked,
    profileName: profileName(profileDir),
    storageStateSaved: portalStorageStateExists(),
    lastLoginSavedAt: portalStorageStateMtime(),
    startupMetrics: portalRuntime.startupMetrics,
    profileLocked: finalLock.locked,
    profileLockPid: finalLock.pid,
    note: finalLock.locked
      ? `Portal browser session is still locked${finalLock.pid ? ` by process ${finalLock.pid}` : ""}. Close the controlled portal browser manually.`
      : "Portal profile lock released. You can open the HEFAMAA portal again.",
  };
}

function isBlankOrNewTab(page: Page) {
  return page.url() === "about:blank" || page.url().startsWith("chrome://new-tab-page");
}

function usablePages(context: BrowserContext) {
  return context.pages().filter((page) => !page.isClosed());
}

function isPortalPage(page: Page) {
  try {
    return new URL(page.url()).hostname === new URL(getPortalUrl()).hostname;
  } catch {
    return false;
  }
}

function getFacilitiesUrl() {
  return new URL("/exec/facilities", getPortalUrl()).toString();
}

function getPortalHomeUrl() {
  return new URL("/exec/home", getPortalUrl()).toString();
}

function getFacilityRouteCandidateUrls() {
  return Array.from(new Set([
    getFacilitiesUrl(),
    new URL("/exec/facility", getPortalUrl()).toString(),
    new URL("/exec/all-facilities", getPortalUrl()).toString(),
    new URL("/exec/applications", getPortalUrl()).toString(),
    new URL("/exec/registration", getPortalUrl()).toString(),
    new URL("/exec/registrations", getPortalUrl()).toString(),
  ]));
}

type FacilitiesGridReadiness = {
  gridAttached: boolean;
  gridVisible: boolean;
  rowCount: number;
  currentUrl: string;
  pageTitle: string;
};

function facilitiesGridSelector() {
  return "table#mainGrid, #mainGrid, table.dataTable";
}

async function getFacilitiesGridReadiness(page: Page, timeoutMs = 8_000): Promise<FacilitiesGridReadiness> {
  const grid = page.locator(facilitiesGridSelector()).first();
  const rowLocator = page.locator("#mainGrid tbody tr, table#mainGrid tbody tr, table.dataTable tbody tr, .dataTable tbody tr");

  await grid.waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
  const gridAttached = await grid.count().then((count) => count > 0).catch(() => false);
  const gridVisible = gridAttached ? await grid.isVisible().catch(() => false) : false;

  if (gridAttached) {
    await rowLocator.first().waitFor({ state: "attached", timeout: timeoutMs }).catch(() => undefined);
  }

  const rowCount = await rowLocator.count().catch(() => 0);
  const pageTitle = await page.title().catch(() => "HEFAMAA portal");
  const currentUrl = page.url();
  const readiness = { gridAttached, gridVisible, rowCount, currentUrl, pageTitle };
  console.info("[portal/scan] facilities grid readiness", readiness);
  return readiness;
}

async function pageHasFacilitiesGrid(page: Page) {
  const readiness = await getFacilitiesGridReadiness(page, 1_500).catch(() => ({
    currentUrl: page.url(),
    gridAttached: false,
    gridVisible: false,
    pageTitle: "HEFAMAA portal",
    rowCount: 0,
  } satisfies FacilitiesGridReadiness));
  return readiness.gridVisible || readiness.rowCount > 0 || readiness.gridAttached;
}

async function isPortalLoginScreen(page: Page) {
  const url = page.url().toLowerCase();
  if (url.includes("/login")) return true;

  const title = (await page.title().catch(() => "")).toLowerCase();
  if (title.includes("login")) return true;

  const body = (await page.locator("body").innerText({ timeout: 2_000 }).catch(() => "")).toLowerCase();
  return body.includes("facility registration portal") && body.includes("email") && body.includes("password") && body.includes("login");
}
async function waitForManualPortalLogin(page: Page, timeoutMs = 120_000) {
  if (!(await isPortalLoginScreen(page))) return;

  updatePortalScanProgress({
    error: undefined,
    message: "Waiting for manual HEFAMAA portal login in the opened browser window.",
    phase: "waiting_for_login",
    status: "running",
  });

  await page.bringToFront().catch(() => undefined);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    throwIfPortalScanStopped();
    await page.waitForTimeout(1_000).catch(() => undefined);
    throwIfPortalScanStopped();
    if (!(await isPortalLoginScreen(page))) {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      updatePortalScanProgress({
        message: "Portal login detected. Looking for the facilities table...",
        phase: "finding_facilities",
      });
      return;
    }
  }

  throw new Error("HEFAMAA portal is still on the login screen. Log in inside the opened portal browser window, wait for the dashboard to load, then run Full Detail Scan again.");
}

async function collectFacilityNavigationHrefs(page: Page) {
  return page.evaluate(() => {
    const origin = window.location.origin;
    return Array.from(document.querySelectorAll("a[href]"))
      .map((anchor) => {
        const element = anchor as HTMLAnchorElement;
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        const href = element.href;
        return { href, text };
      })
      .filter((link) => link.href.startsWith(origin))
      .filter((link) => /facilit|registration|application/i.test(link.text + " " + link.href))
      .map((link) => link.href);
  }).catch(() => [] as string[]);
}

async function clickFacilityNavigationCandidate(page: Page, options: { loginTimeoutMs?: number; navigationTimeoutMs?: number; settleMs?: number } = {}) {
  const loginTimeoutMs = options.loginTimeoutMs ?? 120_000;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? 10_000;
  const settleMs = options.settleMs ?? 250;

  const candidates = page.locator([
    'a:has-text("Facilities")',
    'a:has-text("Facility")',
    'a:has-text("Applications")',
    'a:has-text("Registration")',
    'button:has-text("Facilities")',
    'button:has-text("Facility")',
    '[role="button"]:has-text("Facilities")',
    '[role="button"]:has-text("Facility")',
  ].join(", "));
  const count = await candidates.count().catch(() => 0);

  for (let index = 0; index < Math.min(count, 20); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) continue;

    const beforeUrl = page.url();
    await candidate.click().catch(() => undefined);
    await page.waitForLoadState("domcontentloaded", { timeout: navigationTimeoutMs }).catch(() => undefined);
    if (settleMs > 0) await page.waitForTimeout(settleMs).catch(() => undefined);
    await waitForManualPortalLogin(page, loginTimeoutMs);
    if (await pageHasFacilitiesGrid(page)) return true;

    if (page.url() !== beforeUrl) {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: navigationTimeoutMs }).catch(() => undefined);
      if (settleMs > 0) await page.waitForTimeout(settleMs).catch(() => undefined);
    }
  }

  return false;
}

async function openFacilitiesGrid(page: Page, options: { loginTimeoutMs?: number; navigationTimeoutMs?: number; settleMs?: number } = {}) {
  const loginTimeoutMs = options.loginTimeoutMs ?? 120_000;
  const navigationTimeoutMs = options.navigationTimeoutMs ?? 30_000;
  const settleMs = options.settleMs ?? 250;
  await waitForManualPortalLogin(page, loginTimeoutMs);

  if (await pageHasFacilitiesGrid(page)) return;

  updatePortalScanProgress({
    message: "Opening the HEFAMAA facilities table...",
    phase: "finding_facilities",
  });

  const routeCandidates = getFacilityRouteCandidateUrls();
  for (const url of routeCandidates) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs }).catch(() => undefined);
    if (settleMs > 0) await page.waitForTimeout(settleMs).catch(() => undefined);
    await waitForManualPortalLogin(page, loginTimeoutMs);
    if (await pageHasFacilitiesGrid(page)) return;
  }

  await page.goto(getPortalHomeUrl(), { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs }).catch(() => undefined);
  if (settleMs > 0) await page.waitForTimeout(settleMs).catch(() => undefined);
  await waitForManualPortalLogin(page, loginTimeoutMs);
  if (await pageHasFacilitiesGrid(page)) return;

  const hrefs = Array.from(new Set(await collectFacilityNavigationHrefs(page)));
  for (const href of hrefs) {
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs }).catch(() => undefined);
    if (settleMs > 0) await page.waitForTimeout(settleMs).catch(() => undefined);
    await waitForManualPortalLogin(page, loginTimeoutMs);
    if (await pageHasFacilitiesGrid(page)) return;
  }

  if (await clickFacilityNavigationCandidate(page, { loginTimeoutMs, navigationTimeoutMs, settleMs })) return;

  const title = await page.title().catch(() => "HEFAMAA portal");
  const currentUrl = page.url();
  throw new Error("The HEFAMAA facilities table is not visible on " + title + " (" + currentUrl + "). Open the Facilities page in the portal browser, then run Full Detail Scan again.");
}

function getCurrentRenewalYear() {
  const configuredYear = Number(process.env.HEFAMAA_CURRENT_RENEWAL_YEAR);
  return Number.isInteger(configuredYear) && configuredYear >= 2000 ? configuredYear : new Date().getFullYear();
}

function extractRenewalYear(value: string) {
  const match = value.match(/\b(?:hf|hef)[-/](20\d{2})\b/i) ?? value.match(/\b(20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

async function navigateToPortal(page: Page, options: { fast?: boolean } = {}) {
  const urls = getPortalEntryUrls();
  let lastError: unknown = null;

  await page.bringToFront().catch(() => undefined);

  for (const url of urls) {
    try {
      await page.goto(url, {
        waitUntil: options.fast ? "commit" : "domcontentloaded",
        timeout: options.fast ? 8_000 : 20_000,
      });
    } catch (error) {
      lastError = error;
      await page.evaluate((targetUrl) => window.location.assign(targetUrl), url).catch(() => undefined);
      if (!options.fast) {
        await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
      }
    }

    if (!isBlankOrNewTab(page) && isPortalPage(page)) {
      await page.bringToFront().catch(() => undefined);
      return;
    }

    if (options.fast && page.url() !== "about:blank") {
      await page.bringToFront().catch(() => undefined);
      return;
    }
  }

  if (isBlankOrNewTab(page)) {
    const details = lastError instanceof Error ? `: ${lastError.message}` : "";
    throw new Error(`Portal browser opened a blank tab and could not navigate to ${urls.join(" or ")}${details}`);
  }

  await page.bringToFront().catch(() => undefined);
}
async function closeExtraBlankTabs(context: BrowserContext, keepPage: Page) {
  await Promise.all(
    usablePages(context)
      .filter((page) => page !== keepPage)
      .map((page) => page.close().catch(() => undefined)),
  );
  await updateOpenTabsCount(context).catch(() => 0);
}

function choosePortalPage(context: BrowserContext, preferredPage?: Page | null) {
  const pages = usablePages(context);
  const preferred = preferredPage && !preferredPage.isClosed() ? preferredPage : null;

  if (preferred && isPortalPage(preferred)) {
    return preferred;
  }

  return pages.find(isPortalPage) ?? pages.find((page) => !isBlankOrNewTab(page)) ?? preferred ?? pages[0] ?? null;
}

async function waitForInitialPage(context: BrowserContext, timeoutMs: number) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const page = choosePortalPage(context);

    if (page) {
      return page;
    }

    await delay(200);
  }

  return null;
}

function isUnsupportedCdpContextError(error: unknown) {
  const message = scanErrorMessage(error);
  return /Browser\.setDownloadBehavior|Browser context management is not supported/i.test(message);
}

async function launchPersistentPortalContext(profileDir: string) {
  const { chromium } = await import("playwright");
  const browserChannel = getPortalBrowserChannel();
  const storageStatePath = getPortalStorageStatePath();
  const debuggingPort = getPortalDebuggingPort();
  mkdirSync(profileDir, { recursive: true });
  ensureRuntimeDataDirForFile(storageStatePath);

  async function connectToDedicatedBrowser(activeProfileDir = profileDir) {
    const browser = await chromium.connectOverCDP("http://127.0.0.1:" + debuggingPort, { timeout: 15_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("Dedicated HEFAMAA portal browser opened without an accessible browser context.");
    return { browser, browserChannel, context, profileDir: activeProfileDir, storageStatePath };
  }

  async function launchManagedPersistentContext(activeProfileDir = profileDir) {
    mkdirSync(activeProfileDir, { recursive: true });
    const lock = getPortalProfileLock(activeProfileDir);
    if (lock.locked) {
      await resetStuckDedicatedPortalBrowser(activeProfileDir);
      const nextLock = getPortalProfileLock(activeProfileDir);
      if (nextLock.locked) throw portalProfileLockedError(nextLock, activeProfileDir);
    } else if (hasPortalSingletonFiles(activeProfileDir)) {
      // Chrome can leave Singleton* symlinks behind after a crash or forced close.
      // If the PID is already dead, the files are stale and block the next persistent launch.
      clearPortalSingletonFiles(activeProfileDir);
    }

    const headless = shouldRunPortalHeadless();
    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      acceptDownloads: true,
      args: [
        "--start-maximized",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--disable-popup-blocking",
        "--disable-blink-features=AutomationControlled",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
      ],
      headless,
      ignoreHTTPSErrors: true,
      timeout: 60_000,
      viewport: headless ? { height: 900, width: 1440 } : null,
    };

    if (browserChannel) {
      launchOptions.channel = browserChannel;
    } else {
      launchOptions.executablePath = getPortalChromeExecutable(chromium.executablePath());
    }

    const context = await chromium.launchPersistentContext(activeProfileDir, launchOptions);
    const page = choosePortalPage(context) ?? (await context.newPage());
    await navigateToPortal(page, { fast: true }).catch(() => undefined);
    await page.bringToFront().catch(() => undefined);
    portalRuntime.dedicatedBrowserPid = undefined;
    return { browser: context.browser(), browserChannel, context, profileDir: activeProfileDir, storageStatePath };
  }

  async function launchManagedPersistentContextWithRecovery() {
    try {
      return await launchManagedPersistentContext(profileDir);
    } catch (error) {
      if (!isTimeoutError(error)) throw error;

      await resetStuckDedicatedPortalBrowser(profileDir).catch(() => undefined);
      clearPortalSingletonFiles(profileDir);
      const recoveryProfileDir = getRecoveryPortalProfileDir(profileDir);
      await resetStuckDedicatedPortalBrowser(recoveryProfileDir).catch(() => undefined);
      clearPortalSingletonFiles(recoveryProfileDir);
      appendPortalScanEvent({
        error: scanErrorMessage(error),
        message: "Primary portal browser profile timed out. Opening a clean recovery profile so the scan can continue after login.",
        status: "info",
      });
      return await launchManagedPersistentContext(recoveryProfileDir);
    }
  }

  async function spawnDedicatedBrowser(activeProfileDir = profileDir) {
    const lock = getPortalProfileLock(activeProfileDir);
    if (lock.locked) throw portalProfileLockedError(lock, activeProfileDir);

    const executable = getPortalChromeExecutable(chromium.executablePath());
    const child = spawn(
      executable,
      [
        "--remote-debugging-port=" + debuggingPort,
        "--user-data-dir=" + activeProfileDir,
        "--start-maximized",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--disable-popup-blocking",
        "--disable-blink-features=AutomationControlled",
        "--ignore-certificate-errors",
        "--allow-insecure-localhost",
        getPortalUrl(),
      ],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    portalRuntime.dedicatedBrowserPid = child.pid;
    await waitForPortalDebuggingEndpoint(debuggingPort, 60_000);
  }

  async function launchDedicatedBrowserWithRecovery() {
    try {
      await spawnDedicatedBrowser(profileDir);
      return await connectToDedicatedBrowser(profileDir);
    } catch (error) {
      await resetStuckDedicatedPortalBrowser(profileDir).catch(() => undefined);
      clearPortalSingletonFiles(profileDir);
      const recoveryProfileDir = getRecoveryPortalProfileDir(profileDir);
      await resetStuckDedicatedPortalBrowser(recoveryProfileDir).catch(() => undefined);
      clearPortalSingletonFiles(recoveryProfileDir);
      appendPortalScanEvent({
        error: scanErrorMessage(error),
        message: "Primary portal browser could not be controlled. Opening a clean controlled browser recovery profile so the scan can continue after login.",
        status: "info",
      });
      await spawnDedicatedBrowser(recoveryProfileDir);
      return await connectToDedicatedBrowser(recoveryProfileDir);
    }
  }

  try {
    if (await portalDebuggingEndpointReady(debuggingPort)) {
      try {
        return await connectToDedicatedBrowser();
      } catch (error) {
        if (isUnsupportedCdpContextError(error)) {
          appendPortalScanEvent({
            error: scanErrorMessage(error),
            message: "Existing portal browser rejected Playwright reconnect. Restarting the controlled browser and resuming from cache.",
            status: "info",
          });
          await resetStuckDedicatedPortalBrowser(profileDir);
          return await launchDedicatedBrowserWithRecovery();
        }

        if (!isTimeoutError(error)) throw error;
        await resetStuckDedicatedPortalBrowser(profileDir);
      }
    }

    // Prefer a dedicated browser with a debugging port because it opens quickly and avoids
    // the persistent-context startup hang that can leave Chrome on about:blank.
    if (!(await portalDebuggingEndpointReady(debuggingPort))) {
      try {
        await spawnDedicatedBrowser();
        return await connectToDedicatedBrowser();
      } catch (error) {
        await resetStuckDedicatedPortalBrowser(profileDir).catch(() => undefined);
        if (!isTimeoutError(error) && !isUnsupportedCdpContextError(error)) throw error;
        appendPortalScanEvent({
          error: scanErrorMessage(error),
          message: "Dedicated portal browser was not controllable. Restarting the controlled browser with a clean recovery profile.",
          status: "info",
        });
        return await launchDedicatedBrowserWithRecovery();
      }
    }

    try {
      return await connectToDedicatedBrowser();
    } catch (error) {
      await resetStuckDedicatedPortalBrowser(profileDir).catch(() => undefined);
      if (isUnsupportedCdpContextError(error) || isTimeoutError(error)) {
        return await launchDedicatedBrowserWithRecovery();
      }
      throw error;
    }
  } catch (error) {
    if (isTimeoutError(error)) {
      await resetStuckDedicatedPortalBrowser(profileDir).catch(() => undefined);
      clearPortalSingletonFiles(profileDir);
      throw new Error(
        "Timed out opening the HEFAMAA portal browser with " + browserChannelLabel(browserChannel) + ". Browser session files were cleared automatically. Close any stuck portal browser window, then try Full Detail Scan again; already captured facilities will be skipped.",
      );
    }

    throw error;
  }
}

async function isPortalSessionHealthy(session: PortalSession, timeoutMs = 1_500) {
  if (!session.context || !session.page || session.page.isClosed()) return false;

  try {
    await withTimeout(
      session.page.evaluate(() => document.readyState),
      timeoutMs,
      "Portal browser session health check timed out.",
    );
    return true;
  } catch {
    return false;
  }
}

async function discardStalePortalSession(session: PortalSession, reason: string) {
  setSession(null);
  portalRuntime.openingSession = null;
  appendPortalScanEvent({
    message: reason,
    status: "info",
  });
  await closePortalSession(session, 2_500).catch(() => undefined);
}

async function createPortalSession(options: { fastOpen?: boolean } = {}) {
  const closingSession = portalRuntime.closingSession;
  if (closingSession) {
    await withTimeout(closingSession, 4_000, "Previous HEFAMAA portal browser is still closing; retrying with a clean launch.").catch(() => undefined);
  }

  const profileDir = getPortalProfileDir();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  if (!options.fastOpen && !(await portalDebuggingEndpointReady(getPortalDebuggingPort()))) {
    await verifyPortalHostResolves().catch((error) => {
      const message = error instanceof Error ? error.message : "Unable to verify the HEFAMAA portal host before opening the browser.";
      updatePortalScanProgress({
        error: undefined,
        message,
      });
    });
  }

  try {
    const browserLaunchStartedAt = Date.now();
    const launched = await launchPersistentPortalContext(profileDir);
    updateStartupMetric("browserLaunchMs", browserLaunchStartedAt);
    browser = launched.browser;
    context = launched.context;
    const page = (await waitForInitialPage(context, options.fastOpen ? 600 : 2_000)) ?? (await context.newPage());

    page.setDefaultTimeout(10_000);
    await hydratePortalStorageState(context, page).catch(() => false);

    const navigationStartedAt = Date.now();
    if (isBlankOrNewTab(page) || !isPortalPage(page)) {
      await withTimeout(
        navigateToPortal(page, { fast: options.fastOpen }),
        options.fastOpen ? 8_000 : 20_000,
        `Timed out loading ${getPortalUrl()} in the HEFAMAA portal browser.`,
      );
    } else if (!options.fastOpen) {
      await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
    }
    updateStartupMetric("portalNavigationMs", navigationStartedAt);

    void closeExtraBlankTabs(context, page).catch(() => undefined);
    await page.bringToFront().catch(() => undefined);

    const now = new Date().toISOString();
    const nextSession = {
      browser: launched.browser,
      browserChannel: launched.browserChannel,
      context,
      page,
      profileDir: launched.profileDir,
      storageStatePath: launched.storageStatePath,
      openedAt: now,
      lastActivity: now,
    };
    await setupPortalResourceBlocking(nextSession).catch(() => undefined);
    setSession(nextSession);

    if (!portalRuntime.cleanupHooksAttached) {
      portalRuntime.cleanupHooksAttached = true;
      process.once("SIGINT", () => {
        const session = getSession();
        if (session) void closePortalSession(session);
        void stopPortalScanKeepAwake();
      });
      process.once("SIGTERM", () => {
        const session = getSession();
        if (session) void closePortalSession(session);
        void stopPortalScanKeepAwake();
      });
    }

    return nextSession;
  } catch (error) {
    if (context) {
      await context.close().catch(() => undefined);
    }

    if (browser) {
      await browser.close().catch(() => undefined);
    }

    setSession(null);
    throw error;
  }
}

async function ensureSession(options: { fastOpen?: boolean } = {}) {
  const currentSession = getSession();

  if (currentSession) {
    if (await isPortalSessionHealthy(currentSession, options.fastOpen ? 900 : 1_800)) {
      return currentSession;
    }

    await discardStalePortalSession(
      currentSession,
      "Stale portal browser session detected. Reconnecting the controlled browser once and resuming from cached scan progress.",
    );
  }

  const existingOpening = portalRuntime.openingSession;
  if (existingOpening) {
    return existingOpening;
  }

  const openingSession = createPortalSession(options);
  portalRuntime.openingSession = openingSession;

  try {
    return await openingSession;
  } finally {
    if (portalRuntime.openingSession === openingSession) {
      portalRuntime.openingSession = null;
    }
  }
}
async function openPortalTab(options: { fastOpen?: boolean } = {}) {
  const currentSession = getSession();

  if (currentSession && !(await isPortalSessionHealthy(currentSession, options.fastOpen ? 900 : 1_800))) {
    await discardStalePortalSession(
      currentSession,
      "Stale portal browser session detected while opening the portal. Reconnecting the controlled browser once.",
    );
    return ensureSession({ fastOpen: options.fastOpen });
  }

  if (currentSession) {
    const activePage = choosePortalPage(currentSession.context, currentSession.page);

    if (activePage) {
      activePage.setDefaultTimeout(15_000);

      if (isBlankOrNewTab(activePage) || !isPortalPage(activePage)) {
        await navigateToPortal(activePage, { fast: options.fastOpen });
      }

      void closeExtraBlankTabs(currentSession.context, activePage).catch(() => undefined);
      await activePage.bringToFront().catch(() => undefined);
      currentSession.page = activePage;
      setSession(currentSession);
      return currentSession;
    }
  }

  return ensureSession({ fastOpen: options.fastOpen });
}

async function reconnectExistingDedicatedPortalSession() {
  const debuggingPort = getPortalDebuggingPort();
  if (!(await portalDebuggingEndpointReady(debuggingPort))) return null;

  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.connectOverCDP("http://127.0.0.1:" + debuggingPort, { timeout: 5_000 });
    const context = browser.contexts()[0];
    if (!context) return null;

    const page = choosePortalPage(context) ?? (await context.newPage());
    page.setDefaultTimeout(10_000);
    await hydratePortalStorageState(context, page).catch(() => false);

    if (isBlankOrNewTab(page) || !isPortalPage(page)) {
      await navigateToPortal(page, { fast: true }).catch(() => undefined);
    }

    await page.bringToFront().catch(() => undefined);

    const now = new Date().toISOString();
    const session: PortalSession = {
      browser,
      browserChannel: getPortalBrowserChannel(),
      context,
      page,
      profileDir: getPortalProfileDir(),
      storageStatePath: getPortalStorageStatePath(),
      openedAt: now,
      lastActivity: now,
    };
    await setupPortalResourceBlocking(session).catch(() => undefined);
    setSession(session);
    return session;
  } catch (error) {
    console.warn("[portal/session] existing dedicated portal session is not reusable", scanErrorMessage(error));
    return null;
  }
}

async function requireActivePortalSessionForScan(mode: PortalScanMode) {
  if (process.env.RENDER && !getSession()) {
    throw new Error("Portal scanning needs a logged-in Playwright browser session. Render cannot control your local browser tab directly; run portal scans locally or connect a controlled portal browser bridge/headless login workflow first.");
  }

  const openingSession = portalRuntime.openingSession;
  if (openingSession) {
    await withTimeout(openingSession, 8_000, "Portal browser is still opening. Please wait for it to finish, log in, then run the scan again.").catch(() => undefined);
  }

  let currentSession = getSession();
  if (currentSession && !(await isPortalSessionHealthy(currentSession, 1_200))) {
    await discardStalePortalSession(
      currentSession,
      "Stale HEFAMAA portal browser session detected before portal scan. Reopen the portal and log in before scanning.",
    );
    currentSession = null;
  }

  let session = currentSession ?? await reconnectExistingDedicatedPortalSession();
  if (!session && portalStorageStateExists()) {
    console.info("[portal/scan] no active browser session; opening controlled portal browser with saved session state");
    session = await ensureSession({ fastOpen: true }).catch(() => null);
  }

  if (session && !session.page.isClosed() && await isPortalSessionHealthy(session, 1_200)) {
    const page = choosePortalPage(session.context, session.page) ?? session.page;
    session.page = page;
    session.lastActivity = new Date().toISOString();
    await setupPortalResourceBlocking(session).catch(() => undefined);
    setSession(session);
    return session;
  }

  const label = mode === "full" ? "Full Scan" : "Quick Scan";
  throw new Error("Please click Open Portal and login first before running " + label + ".");
}

type FullScanPreflightStatus = {
  browserOpen: boolean;
  browserConnected: boolean;
  sessionSaved: boolean;
  loggedIn: boolean;
  currentUrl: string | null;
  facilityListDetected: boolean;
  readyForFullScan: boolean;
  reason: string | null;
};

function fullScanPreflightFailure(input: Partial<FullScanPreflightStatus> & { reason: string }): FullScanPreflightStatus {
  return {
    browserOpen: false,
    browserConnected: false,
    sessionSaved: portalStorageStateExists(),
    loggedIn: false,
    currentUrl: null,
    facilityListDetected: false,
    readyForFullScan: false,
    ...input,
  };
}

async function runFullScanPreflight(mode: PortalScanMode, options: { ensureFacilityList?: boolean; timeoutMs?: number } = {}): Promise<FullScanPreflightStatus> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const startedAt = Date.now();
  console.info("[portal/scan] Full Scan preflight started", { mode });

  return withTimeout((async () => {
    let session = getSession();
    if (session && session.page.isClosed()) {
      session = null;
    }

    if (session) {
      console.info("[portal/scan] Existing active session found. Reusing active browser session.");
    } else {
      console.info("[portal/scan] No active in-memory session found before scan.");
      session = await reconnectExistingDedicatedPortalSession();
    }

    if (!session && portalStorageStateExists()) {
      console.info("[portal/scan] Saved portal session exists. Opening controlled browser with saved storage state.");
      session = await ensureSession({ fastOpen: true }).catch((error) => {
        console.warn("[portal/scan] saved session browser open failed", scanErrorMessage(error));
        return null;
      });
    }

    if (!session || session.page.isClosed()) {
      return fullScanPreflightFailure({ reason: "Portal browser not open", sessionSaved: portalStorageStateExists() });
    }

    if (!(await isPortalSessionHealthy(session, 1_200))) {
      return fullScanPreflightFailure({ browserOpen: true, currentUrl: session.page.url(), reason: "Browser disconnected", sessionSaved: portalStorageStateExists() });
    }

    const page = choosePortalPage(session.context, session.page) ?? session.page;
    session.page = page;
    session.lastActivity = new Date().toISOString();
    setSession(session);
    await page.bringToFront().catch(() => undefined);
    console.info("[portal/scan] Current portal URL", page.url());

    const loggedIn = await detectLoggedInPage(page);
    console.info("[portal/scan] Login status detected", { loggedIn });
    if (!loggedIn) {
      return fullScanPreflightFailure({ browserOpen: true, browserConnected: true, currentUrl: page.url(), reason: "Not logged in", sessionSaved: portalStorageStateExists() });
    }

    let facilityListDetected = await detectFacilityListPage(page);
    console.info("[portal/scan] Facility list detected", { facilityListDetected });

    if (!facilityListDetected && options.ensureFacilityList) {
      const remainingMs = Math.max(2_000, timeoutMs - (Date.now() - startedAt));
      await openFacilitiesGrid(page, {
        loginTimeoutMs: Math.min(remainingMs, 5_000),
        navigationTimeoutMs: Math.min(remainingMs, 6_000),
        settleMs: 0,
      }).catch((error) => {
        console.warn("[portal/scan] facility list navigation failed", scanErrorMessage(error));
      });
      facilityListDetected = await detectFacilityListPage(page);
      console.info("[portal/scan] Facility list detected after navigation", { facilityListDetected });
    }

    if (!facilityListDetected) {
      return fullScanPreflightFailure({ browserOpen: true, browserConnected: true, currentUrl: page.url(), loggedIn: true, reason: "Facility list not detected", sessionSaved: portalStorageStateExists() });
    }

    return {
      browserOpen: true,
      browserConnected: true,
      sessionSaved: portalStorageStateExists(),
      loggedIn: true,
      currentUrl: page.url(),
      facilityListDetected: true,
      readyForFullScan: true,
      reason: null,
    };
  })(), timeoutMs, "Full Scan could not start because: Page stuck/loading").catch((error) => {
    const message = scanErrorMessage(error).replace(/^Full Scan could not start because:\s*/i, "");
    console.warn("[portal/scan] Full Scan preflight failed", message);
    return fullScanPreflightFailure({ reason: message || "Page stuck/loading", sessionSaved: portalStorageStateExists() });
  });
}
async function getActiveSession() {
  const openingSession = portalRuntime.openingSession;
  if (!getSession() && openingSession) {
    await openingSession;
  }

  if (!getSession() && (await portalDebuggingEndpointReady(getPortalDebuggingPort()))) {
    await ensureSession({ fastOpen: true });
  }

  const currentSession = getSession();

  if (currentSession && !(await isPortalSessionHealthy(currentSession, 1_200))) {
    await discardStalePortalSession(
      currentSession,
      "Stale HEFAMAA portal browser session detected while checking the active portal. Reconnect before continuing.",
    );
  }

  const healthySession = getSession();

  if (healthySession) {
    const activePage = choosePortalPage(healthySession.context, healthySession.page);

    if (activePage) {
      activePage.setDefaultTimeout(15_000);

      if (isBlankOrNewTab(activePage) || !isPortalPage(activePage)) {
        await navigateToPortal(activePage, { fast: true }).catch(() => undefined);
      }

      void closeExtraBlankTabs(healthySession.context, activePage).catch(() => undefined);
      healthySession.page = activePage;
      await activePage.bringToFront().catch(() => undefined);
      setSession(healthySession);
      return healthySession;
    }
  }

  throw new Error("Portal browser session is not active. Click Open HEFAMAA Portal, log in if needed, then search or capture.");
}
async function getVisibleText(page: Page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 3_000 }).catch(() => undefined);

  // Direct DOM reads are much faster than locator.innerText on heavy portal pages.
  const quickText = await page.evaluate(() => document.body?.innerText || document.documentElement?.innerText || "").catch(() => "");
  if (quickText.replace(/\s+/g, " ").trim()) return quickText;

  await page.locator("body").waitFor({ state: "attached", timeout: 3_000 }).catch(() => undefined);

  try {
    return await page.locator("body").innerText({ timeout: 5_000 });
  } catch (error) {
    await page.waitForFunction(() => Boolean((document.body?.innerText || document.documentElement?.innerText || "").replace(/\s+/g, " ").trim()), null, { timeout: 800 }).catch(() => undefined);
    const retryText = await page.evaluate(() => document.body?.innerText || document.documentElement?.innerText || "").catch(() => "");
    if (retryText.replace(/\s+/g, " ").trim()) return retryText;

    throw error;
  }
}

async function getVisibleFormFields(page: Page): Promise<VisibleFormField[]> {
  return page.evaluate(() => {
    function isVisible(element: Element) {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    }

    function clean(value: string | null | undefined) {
      return String(value ?? "").replace(/\s+/g, " ").trim();
    }

    function labelFor(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
      const id = element.getAttribute("id");

      if (id) {
        const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        const text = clean(label?.textContent);
        if (text) return text;
      }

      const ariaLabel = clean(element.getAttribute("aria-label"));
      if (ariaLabel) return ariaLabel;

      const placeholder = clean(element.getAttribute("placeholder"));
      if (placeholder) return placeholder;

      const name = clean(element.getAttribute("name"));
      if (name) return name.replace(/[_-]+/g, " ");

      const wrappingLabel = element.closest("label");
      const wrappingText = clean(wrappingLabel?.textContent);
      if (wrappingText) return wrappingText.replace(clean(element.value), "").trim() || wrappingText;

      const rowText = clean(element.closest("tr, .row, .form-group, .mb-3, .field")?.textContent);
      if (rowText) return rowText.replace(clean(element.value), "").trim() || rowText;

      return "Unlabelled field";
    }

    function valueFor(element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement) {
      if (element instanceof HTMLSelectElement) {
        return clean(element.selectedOptions[0]?.textContent || element.value);
      }

      if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
        return element.checked ? "Checked" : "";
      }

      return clean(element.value);
    }

    return Array.from(document.querySelectorAll("input, select, textarea"))
      .filter((element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement => {
        if (!(element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)) {
          return false;
        }

        if (!isVisible(element)) return false;
        if (element instanceof HTMLInputElement && ["hidden", "password", "file"].includes(element.type)) return false;

        return Boolean(valueFor(element));
      })
      .map((element) => ({
        label: labelFor(element),
        value: valueFor(element),
        type: element instanceof HTMLInputElement ? element.type || "text" : element.tagName.toLowerCase(),
      }));
  });
}

async function getVisibleTables(page: Page) {
  return page.evaluate(() => {
    return Array.from(document.querySelectorAll("table"))
      .filter((table) => {
        const style = window.getComputedStyle(table);
        const rect = table.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
      })
      .map((table) =>
        Array.from(table.querySelectorAll("tr")).map((row) =>
          Array.from(row.querySelectorAll("th,td"))
            .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
            .filter(Boolean),
        ),
      )
      .filter((table) => table.length > 0);
  });
}

function cleanPortalText(value: string | null | undefined) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function fieldValueByLabel(fields: VisibleFormField[], labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());

  for (const field of fields) {
    const label = cleanPortalText(field.label).toLowerCase();
    if (normalizedLabels.some((candidate) => label.includes(candidate))) {
      const value = cleanPortalText(field.value);
      if (value) return value;
    }
  }

  return "";
}

function escapeRegExp(value: string) {
  return value.replace(/[\^$.*+?()[\]{}|]/g, "\\$&");
}

function textValueByLabel(text: string, labels: string[]) {
  const lines = text
    .split(/\n+/)
    .map(cleanPortalText)
    .filter(Boolean);

  for (const label of labels) {
    const pattern = new RegExp("^" + escapeRegExp(label) + "\\s*[:\\-]?\\s*(.+)$", "i");
    const normalizedLabel = normalizeRequiredDetailLabel(label);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const match = line.match(pattern);
      if (match?.[1]) return cleanPortalText(match[1]);

      const normalizedLine = normalizeRequiredDetailLabel(line.replace(/[:\-]+$/, ""));
      if (normalizedLine && normalizedLabel && (normalizedLine === normalizedLabel || normalizedLine.endsWith(" " + normalizedLabel))) {
        const next = cleanPortalText(lines[index + 1]);
        if (next && normalizeRequiredDetailLabel(next) !== normalizedLabel) return next;
      }
    }
  }

  return "";
}

function firstTableValueByHeader(tables: string[][][], labels: string[]) {
  const normalizedLabels = labels.map((label) => label.toLowerCase());

  for (const table of tables) {
    const header = table[0] ?? [];
    const headerIndex = header.findIndex((cell) => {
      const normalized = cleanPortalText(cell).toLowerCase();
      return normalizedLabels.some((label) => normalized.includes(label));
    });

    if (headerIndex < 0) continue;

    for (const row of table.slice(1)) {
      const value = cleanPortalText(row[headerIndex]);
      if (value) return value;
    }
  }

  return "";
}

function extractHefamaaIdFromText(text: string) {
  return text.match(/\b(?:e[-\s]?)?h(?:ef|f)[-/][a-z0-9][a-z0-9/_.-]*\b/i)?.[0] ?? "";
}

function extractYearFromText(text: string) {
  const idYear = text.match(/\b(?:e[-\s]?)?h(?:ef|f)[-/](20\d{2})\b/i);
  const anyYear = text.match(/\b(20\d{2})\b/);
  return idYear ? Number(idYear[1]) : anyYear ? Number(anyYear[1]) : null;
}

function inferPortalRecordFromCapture(input: {
  bodyText: string;
  formFields: VisibleFormField[];
  tables: string[][][];
  renewalSelection?: PortalRenewalSelection | null;
}): FacilitySearchResultRow | null {
  if (input.renewalSelection?.selectedRecord) {
    return input.renewalSelection.selectedRecord;
  }

  const bodyText = input.bodyText;
  const facilityName =
    fieldValueByLabel(input.formFields, ["facility name", "name of facility", "organisation name", "organization name"]) ||
    textValueByLabel(bodyText, ["Facility Name", "Name of Facility", "Organisation Name", "Organization Name"]) ||
    firstTableValueByHeader(input.tables, ["facility name", "name of facility"]);
  const category =
    fieldValueByLabel(input.formFields, ["category", "facility type", "type of facility", "facility category"]) ||
    textValueByLabel(bodyText, ["Category", "Facility Type", "Type of Facility", "Facility Category"]) ||
    firstTableValueByHeader(input.tables, ["category", "facility type", "type"]);
  const registrationStatus =
    fieldValueByLabel(input.formFields, ["status", "registration status", "approval status", "application status"]) ||
    textValueByLabel(bodyText, ["Status", "Registration Status", "Approval Status", "Application Status"]) ||
    firstTableValueByHeader(input.tables, ["status", "registration status", "approval"]);
  const hefamaaId =
    fieldValueByLabel(input.formFields, ["hef", "hefamaa", "registration number", "permit number"]) ||
    textValueByLabel(bodyText, ["HEF/NO", "HEF No", "HEFAMAA No", "Registration Number", "Permit Number"]) ||
    extractHefamaaIdFromText(bodyText);
  const renewalYear = extractYearFromText(hefamaaId || bodyText);

  if (!facilityName && !category && !registrationStatus && !hefamaaId) {
    return null;
  }

  return {
    index: -1,
    facilityName,
    hefamaaId,
    category,
    registrationStatus,
    renewalYear,
    text: cleanPortalText([facilityName, hefamaaId, category, registrationStatus].filter(Boolean).join(" | ")),
    hasAction: false,
  };
}
function buildPortalSnapshotText(input: {
  bodyText: string;
  formFields: VisibleFormField[];
  renewalSelection?: PortalRenewalSelection | null;
  tables: string[][][];
}) {
  const sections = [];

  if (input.renewalSelection) {
    const selection = input.renewalSelection;
    sections.push(
      [
        "PORTAL RENEWAL CONTEXT:",
        `Current renewal year: ${selection.currentRenewalYear}`,
        `Latest available portal renewal year: ${selection.latestAvailableRenewalYear ?? "Unknown"}`,
        `Selected portal renewal year: ${selection.selectedRenewalYear ?? "Unknown"}`,
        `Renewal status: ${selection.renewalStatus}`,
        `Selected E-HEFAMAA ID: ${selection.selectedRecord.hefamaaId || "Unknown"}`,
        `Selected registration status: ${selection.selectedRecord.registrationStatus || "Unknown"}`,
        `Selected category: ${selection.selectedRecord.category || "Unknown"}`,
        selection.approvalEvidence.length
          ? `Admin approval evidence:\n${selection.approvalEvidence.map((line) => `- ${line}`).join("\n")}`
          : "Admin approval evidence: Not visible on the current portal screen",
      ].join("\n"),
    );
  }

  sections.push(`VISIBLE PAGE TEXT:\n${input.bodyText.trim()}`);

  if (input.formFields.length) {
    sections.push(
      `VISIBLE FORM FIELDS:\n${input.formFields
        .map((field) => `${field.label}: ${field.value}`)
        .join("\n")}`,
    );
  }

  if (input.tables.length) {
    sections.push(
      `VISIBLE TABLES:\n${input.tables
        .map((table, tableIndex) =>
          [`Table ${tableIndex + 1}:`, ...table.map((row) => row.join(" | "))].join("\n"),
        )
        .join("\n\n")}`,
    );
  }

  return sections.join("\n\n").trim();
}

async function firstVisibleEditableSearchInput(page: Page) {
  const searchInputs = page.locator(
    [
      'input[type="search"]',
      'input[name*="search" i]',
      'input[id*="search" i]',
      'input[placeholder*="search" i]',
      'input[placeholder*="facility" i]',
      'input[aria-label*="search" i]',
      'input[type="text"]',
    ].join(", "),
  );

  const count = await searchInputs.count();

  for (let index = 0; index < count; index += 1) {
    const input = searchInputs.nth(index);
    const [isVisible, isEditable, type] = await Promise.all([
      input.isVisible().catch(() => false),
      input.isEditable().catch(() => false),
      input.getAttribute("type").catch(() => ""),
    ]);

    if (isVisible && isEditable && type !== "password") {
      return input;
    }
  }

  return null;
}

async function firstVisibleFacilitySearchInput(page: Page) {
  const searchInputs = page.locator("#mainGrid-search-txt, input[placeholder*='Search' i], input[type='search']");
  const count = await searchInputs.count();

  for (let index = 0; index < count; index += 1) {
    const input = searchInputs.nth(index);
    const [isVisible, isEditable, type] = await Promise.all([
      input.isVisible().catch(() => false),
      input.isEditable().catch(() => false),
      input.getAttribute("type").catch(() => ""),
    ]);

    if (isVisible && isEditable && type !== "password") {
      return input;
    }
  }

  return null;
}

async function waitForDataTableIdle(page: Page, timeoutMs = 6_000) {
  await page.waitForFunction(
    () => {
      const processing = document.querySelector<HTMLElement>("#mainGrid_processing, .dataTables_processing");
      if (!processing) return true;
      const style = window.getComputedStyle(processing);
      return style.display === "none" || style.visibility === "hidden" || processing.offsetParent === null;
    },
    null,
    { timeout: timeoutMs },
  ).catch(() => undefined);
}

async function fillFacilitySearchInput(page: Page, input: ReturnType<Page["locator"]>, query: string) {
  await waitForDataTableIdle(page, 4_000);

  try {
    await input.scrollIntoViewIfNeeded({ timeout: 1_000 }).catch(() => undefined);
    await input.click({ timeout: 1_500 });
    await input.fill("", { timeout: 1_500 });
    await input.fill(query, { timeout: 2_500 });
    return true;
  } catch {
    // The HEFAMAA grid sometimes leaves the search input visible but temporarily not editable.
    // Direct DOM assignment is faster than burning a full Playwright timeout, and still triggers the same input/change events.
  }

  return input.evaluate((element, value) => {
    const inputElement = element as HTMLInputElement;
    if (inputElement.disabled || inputElement.readOnly) return false;
    inputElement.focus();
    inputElement.value = value;
    inputElement.dispatchEvent(new Event("input", { bubbles: true }));
    inputElement.dispatchEvent(new Event("change", { bubbles: true }));
    inputElement.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
    return true;
  }, query).catch(() => false);
}

async function clickSearchButtonIfAvailable(page: Page) {
  const buttons = page.locator(
    [
      'button[id*="search" i]',
      'button[class*="search" i]',
      'button:has-text("Search")',
      'button:has-text("Find")',
      'button:has-text("Filter")',
      'input[type="submit"][value*="Search" i]',
      'input[type="button"][value*="Search" i]',
      '[role="button"]:has-text("Search")',
    ].join(", "),
  );
  const count = await buttons.count();

  for (let index = 0; index < count; index += 1) {
    const button = buttons.nth(index);
    const isVisible = await button.isVisible().catch(() => false);

    if (isVisible) {
      await button.click().catch(() => undefined);
      return true;
    }
  }

  return false;
}

async function openFacilitiesSearchPage(page: Page) {
  const existingInput = await firstVisibleFacilitySearchInput(page);

  if (existingInput && (await pageHasFacilitiesGrid(page))) {
    return existingInput;
  }

  await openFacilitiesGrid(page);
  await page.waitForSelector("#mainGrid-search-txt, input[placeholder*='Search' i], input[type='search']", {
    timeout: 3_000,
  }).catch(() => undefined);

  return firstVisibleFacilitySearchInput(page);
}

async function waitForFacilitySearchResults(page: Page, query: string, previousFingerprint = "") {
  await page.waitForLoadState("domcontentloaded", { timeout: 2_500 }).catch(() => undefined);
  await page.waitForFunction(
    ({ previousFingerprint, query }) => {
      const processing = document.querySelector<HTMLElement>("#mainGrid_processing, .dataTables_processing");
      const processingVisible = processing
        ? window.getComputedStyle(processing).display !== "none" && processing.offsetParent !== null
        : false;
      const fingerprint = document.querySelector("#mainGrid tbody")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      const body = document.body?.innerText?.toLowerCase() ?? "";
      const queryText = String(query || "").toLowerCase();
      const queryVisible = Boolean(queryText) && body.includes(queryText);
      const noMatch = /no matching|no records|no data available/i.test(body);

      return !processingVisible && (queryVisible || noMatch || (Boolean(fingerprint) && fingerprint !== previousFingerprint));
    },
    { previousFingerprint, query },
    { timeout: 3_500 },
  ).catch(() => undefined);
  await waitForDataTableIdle(page, 1_200);
}

async function getFacilityResultRows(page: Page) {
  return page.evaluate(() => {
    function clean(value: string | null | undefined) {
      return String(value ?? "").replace(/\s+/g, " ").trim();
    }

    function normalized(value: string) {
      return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    }

    function headerIndex(headers: string[], aliases: string[]) {
      return headers.findIndex((header) => aliases.some((alias) => normalized(header).includes(alias)));
    }

    function valueByHeader(cells: string[], headers: string[], aliases: string[]) {
      const index = headerIndex(headers, aliases);
      return index >= 0 ? cells[index] ?? "" : "";
    }

    function looksLikeAction(value: string) {
      return /^(view|edit|action|details|open|select)$/i.test(value);
    }

    function extractHefamaaId(cells: string[], text: string) {
      const idPattern = /\b(?:e[-\s]?)?h(?:ef|f)[-/][a-z0-9][a-z0-9/_.-]*\b/i;
      return cells.find((cell) => idPattern.test(cell))?.match(idPattern)?.[0] ?? text.match(idPattern)?.[0] ?? "";
    }

    function extractRenewalYearFromText(value: string) {
      const idYear = value.match(/\b(?:e[-\s]?)?h(?:ef|f)[-/](20\d{2})\b/i);
      const anyYear = value.match(/\b(20\d{2})\b/);
      return idYear ? Number(idYear[1]) : anyYear ? Number(anyYear[1]) : null;
    }

    function extractRecordDate(value: string) {
      const cleaned = clean(value);
      const match = cleaned.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{2}|\d{4}))\b/);
      return match ? match[1].replace(/-/g, "/") : null;
    }

    return Array.from(document.querySelectorAll("table tbody tr"))
      .map((row, index) => {
        const cells = Array.from(row.querySelectorAll("td, th")).map((cell) => clean(cell.textContent));
        const text = clean(row.textContent);
        const table = row.closest("table");
        const headers = table
          ? Array.from(table.querySelectorAll("thead th, thead td")).map((cell) => clean(cell.textContent))
          : [];
        const action = row.querySelector('a[onclick*="editRow"], a[href="javascript:void(0)"], button, [role="button"]');
        const hefamaaId = extractHefamaaId(cells, text) || valueByHeader(cells, headers, ["hef", "hf", "registration", "permit"]);
        const facilityName =
          valueByHeader(cells, headers, ["facility name", "name of facility", "facility"]) ||
          cells.find((cell) => cell && !looksLikeAction(cell) && cell !== hefamaaId && !/^(approved|pending|current|expired)$/i.test(cell)) ||
          "";
        const category = valueByHeader(cells, headers, ["category", "facility type", "type"]) || cells[2] || "";
        const registrationStatus =
          valueByHeader(cells, headers, ["status", "registration status", "approval"]) ||
          cells.find((cell) => /approved|pending|current|expired|registered/i.test(cell)) ||
          "";
        const renewalYear = extractRenewalYearFromText(hefamaaId || text);
        const recordDate = extractRecordDate(text);
        const visibleFields = cells.reduce<Record<string, string>>((acc, cell, cellIndex) => {
          const header = clean(headers[cellIndex]) || `Column ${cellIndex + 1}`;
          if (cell) acc[header] = cell;
          return acc;
        }, {});

        return {
          index,
          facilityName,
          hefamaaId,
          category,
          registrationStatus,
          renewalYear,
          recordDate,
          visibleFields,
          text,
          hasAction: Boolean(action),
        };
      })
      .filter((row) => row.text && row.hasAction && !/no matching|processing/i.test(row.text));
  });
}

function extractRecordDate(value: string) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  const match = cleaned.match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-](?:\d{2}|\d{4}))\b/);
  return match ? match[1].replace(/-/g, "/") : null;
}

function normalizePortalStatus(registrationStatus: string, renewalYear: number | null): PortalFacilityStatus {
  const value = String(registrationStatus || "").toLowerCase().trim();

  if (value.includes("payment") && value.includes("quer")) {
    return "payment_queried";
  }

  if (value.includes("document") && value.includes("query")) {
    return "document_queried";
  }

  if (value.includes("waiting") && (value.includes("on-board") || value.includes("onboard"))) {
    return "waiting_to_onboard";
  }

  if ((value.includes("payment approved") || value.includes("paid")) && value.includes("pending document")) {
    return "payment_approved_pending_document_approval";
  }

  if ((value.includes("upload") && value.includes("payment")) || value.includes("pending document")) {
    return "upload_payment_pending_document_approval";
  }

  if (value.includes("document approved") && value.includes("inspection")) {
    return "document_approved_inspection_pending";
  }

  if (value.includes("inspection report") && value.includes("pending")) {
    return "inspection_report_upload_pending_approval";
  }

  if (value.includes("final approval") || value.includes("provisional") || value.includes("license")) {
    return "final_approval_pending";
  }

  if (value.includes("approved") && value.includes("pending")) {
    return "payment_approved_pending_document_approval";
  }

  if (value.includes("inspection") && value.includes("pending")) {
    return "inspection_report_upload_pending_approval";
  }

  if (value.includes("document") && value.includes("approved")) {
    return "document_approved_inspection_pending";
  }

  if (value.includes("query")) {
    return "document_queried";
  }

  if (value.includes("pending")) {
    return value.includes("inspection")
      ? "inspection_report_upload_pending_approval"
      : "upload_payment_pending_document_approval";
  }

  if (value.includes("registration approved") || value === "approved") {
    return "registration_approved";
  }

  return "unknown_status";
}

function inferPortalApplicationType(record: FacilitySearchResultRow, normalizedStatus: PortalFacilityStatus): PortalApplicationType {
  const value = `${record.text} ${record.registrationStatus}`.toLowerCase();

  if (/\brenew(?:al|ed|ing)?\b/.test(value)) {
    return "renewal";
  }

  if (/\bnew\s+(?:facility\s+)?registration\b|\binitial\s+registration\b/.test(value)) {
    return "new_registration";
  }

  if (normalizedStatus === "document_approved_inspection_pending" || normalizedStatus === "inspection_report_upload_pending_approval") {
    return "new_registration";
  }

  return "unknown";
}

const FACILITY_ADDRESS_FIELD_ALIASES = [
  "address",
  "facility address",
  "location",
  "premises",
  "site address",
  "operational address",
];

const FACILITY_BRANCH_FIELD_ALIASES = [
  "branch",
  "annex",
  "branch name",
  "annex name",
  "location name",
];

const FACILITY_BRANCH_PATTERN = /\b(?:annex|branch|satellite|extension|outstation|site\s*\d+)\b/i;

function portalVisibleFieldValue(record: Pick<FacilitySearchResultRow, "visibleFields">, aliases: string[]) {
  const fields = record.visibleFields ?? {};

  for (const [header, value] of Object.entries(fields)) {
    const normalizedHeader = normalizeSelectionName(header);
    if (!aliases.some((alias) => normalizedHeader.includes(normalizeSelectionName(alias)))) continue;

    const cleanValue = cleanPortalText(value);
    if (cleanValue) return cleanValue;
  }

  return "";
}

function stablePortalIdKey(value: string) {
  return normalizeSelectionName(value)
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function facilityRecordAddressKey(record: FacilitySearchResultRow) {
  if (record.visibleFields?.["Detail Captured At"]) return "";
  const address = portalVisibleFieldValue(record, FACILITY_ADDRESS_FIELD_ALIASES);
  return address ? normalizeSelectionName(address) : "";
}

function facilityRecordBranchKey(record: FacilitySearchResultRow) {
  const explicitBranch = portalVisibleFieldValue(record, FACILITY_BRANCH_FIELD_ALIASES);
  if (explicitBranch) return normalizeSelectionName(explicitBranch);

  const markerText = [record.facilityName, record.category, record.text].filter(Boolean).join(" ");
  const parentheticalBranch = markerText.match(/\(([^)]*(?:annex|branch|satellite|extension|outstation|site\s*\d+)[^)]*)\)/i)?.[1] ?? "";
  if (parentheticalBranch) return normalizeSelectionName(parentheticalBranch);

  const branchSegment = markerText.match(/(?:annex|branch|satellite|extension|outstation|site\s*\d+)(?:\s+[a-z0-9-]+){0,4}/i)?.[0] ?? "";
  return branchSegment ? normalizeSelectionName(branchSegment) : "";
}

function facilityRecordKey(record: FacilitySearchResultRow) {
  const name = normalizeSelectionName(record.facilityName || record.text);
  const category = normalizeSelectionName(record.category);
  const address = facilityRecordAddressKey(record);
  const branch = facilityRecordBranchKey(record);
  const fallbackId = stablePortalIdKey(record.hefamaaId);

  return [name || fallbackId, category, address || branch].join("|");
}

function portalRecordDateTime(record: FacilitySearchResultRow) {
  return parseDateString(record.recordDate)?.getTime() ?? 0;
}

function portalRecordStatusPriority(record: FacilitySearchResultRow) {
  const status = cleanPortalText(record.registrationStatus).toLowerCase();
  if (/approved|current|registered/.test(status)) return 3;
  if (/final/.test(status)) return 2;
  if (/pending/.test(status)) return 1;
  return 0;
}

function selectPreferredLatestRecord(records: PortalFacilityRecord[]) {
  const currentYear = getCurrentRenewalYear();

  return [...records].sort((a, b) => {
    const aCurrent = a.renewalYear === currentYear ? 1 : 0;
    const bCurrent = b.renewalYear === currentYear ? 1 : 0;
    const yearPriority = (b.renewalYear ?? 0) - (a.renewalYear ?? 0);
    const statusPriority = portalRecordStatusPriority(b) - portalRecordStatusPriority(a);
    const actionPriority = Number(b.hasAction) - Number(a.hasAction);
    const datePriority = portalRecordDateTime(b) - portalRecordDateTime(a);

    return bCurrent - aCurrent || yearPriority || statusPriority || actionPriority || datePriority;
  })[0];
}

function facilityRecordFamilyKey(record: FacilitySearchResultRow) {
  const name = normalizeSelectionName(record.facilityName || record.text)
    .replace(/\([^)]*(?:annex|branch|satellite|extension|outstation|site\s*\d+)[^)]*\)/gi, " ")
    .replace(FACILITY_BRANCH_PATTERN, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || stablePortalIdKey(record.hefamaaId);
}

function latestDetailTargetRecords(records: PortalFacilityRecord[]) {
  return latestUniqueFacilityRecords(records)
    .filter((record) => record.hasAction)
    .sort((a, b) => {
      const familyOrder = facilityRecordFamilyKey(a).localeCompare(facilityRecordFamilyKey(b));
      if (familyOrder) return familyOrder;

      const identityOrder = facilityRecordKey(a).localeCompare(facilityRecordKey(b));
      if (identityOrder) return identityOrder;

      return (b.renewalYear ?? 0) - (a.renewalYear ?? 0);
    });
}

function classifyPortalFacilityRecords(records: PortalFacilityRecord[]) {
  const grouped = new Map<string, PortalFacilityRecord[]>();

  for (const record of records) {
    const key = facilityRecordKey(record);
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }

  for (const group of grouped.values()) {
    const years = Array.from(new Set(group.map((record) => record.renewalYear).filter((year): year is number => Boolean(year)))).sort();
    const firstYear = years[0] ?? null;

    for (const record of group) {
      const inferred = inferPortalApplicationType(record, record.normalizedStatus);
      record.applicationType = inferred !== "unknown"
        ? inferred
        : firstYear && record.renewalYear && record.renewalYear > firstYear
          ? "renewal"
          : firstYear && record.renewalYear === firstYear
            ? "new_registration"
            : "unknown";
    }
  }

  return records;
}

function latestUniqueFacilityRecords(records: PortalFacilityRecord[]) {
  const grouped = new Map<string, PortalFacilityRecord[]>();

  for (const record of records) {
    const key = facilityRecordKey(record);
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }

  return Array.from(grouped.values())
    .map((group) => selectPreferredLatestRecord(group))
    .filter((record): record is PortalFacilityRecord => Boolean(record));
}

function countByFacilityType(records: PortalFacilityRecord[]) {
  const grouped = new Map<string, PortalFacilityRecord[]>();
  for (const record of records) {
    const key = facilityRecordKey(record);
    const group = grouped.get(key) ?? [];
    group.push(record);
    grouped.set(key, group);
  }

  const counts: Record<PortalFacilityType, number> = { new_registration: 0, existing_facility: 0, unknown: 0 };
  const currentYear = getCurrentRenewalYear();

  for (const group of grouped.values()) {
    const years = Array.from(new Set(group.map((record) => record.renewalYear).filter((year): year is number => Boolean(year))));
    const explicitRenewal = group.some((record) => record.applicationType === "renewal");
    const latestYear = years.length ? Math.max(...years) : null;

    if (years.length > 1 || explicitRenewal || (latestYear && latestYear < currentYear)) counts.existing_facility += 1;
    else if (latestYear === currentYear || group.some((record) => record.applicationType === "new_registration")) counts.new_registration += 1;
    else counts.unknown += 1;
  }

  return counts;
}

function portalFacilityCachePath() {
  return configuredRuntimeFile("HEFAMAA_PORTAL_FACILITIES_CACHE", "portal-facilities-cache.json");
}

function readPortalFacilityCache(): PortalFacilityRecord[] {
  const cachePath = portalFacilityCachePath();
  const mtimeMs = fileMtimeMs(cachePath);

  if (portalFacilityListCache?.path === cachePath && portalFacilityListCache.mtimeMs === mtimeMs) {
    return portalFacilityListCache.value;
  }

  if (!existsSync(cachePath)) {
    portalFacilityListCache = { path: cachePath, mtimeMs, value: [] };
    portalFacilityExportCache = null;
    portalFacilitySummaryCache = null;
    return [];
  }

  try {
    const raw = readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      portalFacilityListCache = { path: cachePath, mtimeMs, value: parsed };
      portalFacilityExportCache = null;
      portalFacilitySummaryCache = null;
      return parsed;
    }
  } catch {
    // ignore invalid cache data
  }

  portalFacilityListCache = { path: cachePath, mtimeMs, value: [] };
  portalFacilityExportCache = null;
  portalFacilitySummaryCache = null;
  return [];
}

function writePortalFacilityCache(records: PortalFacilityRecord[]) {
  const cachePath = portalFacilityCachePath();
  ensureRuntimeDataDirForFile(cachePath);
  const tempPath = cachePath + ".tmp";
  writeFileSync(tempPath, JSON.stringify(records, null, 2), "utf8");
  renameSync(tempPath, cachePath);
  portalFacilityListCache = { path: cachePath, mtimeMs: fileMtimeMs(cachePath), value: records };
  portalFacilityExportCache = null;
  portalFacilitySummaryCache = null;
}

const STAFF_COMPLEMENT_ALIASES: Record<string, string[]> = {
  Doctors: ["doctor", "medical doctor", "physician"],
  Nurses: ["nurse", "nursing"],
  "Lab Scientists": ["lab scientist", "laboratory scientist", "medical laboratory scientist", "lab sci"],
  "Lab Technicians": ["lab tech", "laboratory technician", "technician"],
  Pharmacists: ["pharmacist"],
  Radiographers: ["radiographer"],
};

function portalFacilityDetailsCachePath() {
  return configuredRuntimeFile("HEFAMAA_PORTAL_DETAILS_CACHE", "portal-facility-details-cache.json");
}

export function readPortalFacilityDetailsCache(): PortalFacilityDetailRecord[] {
  const cachePath = portalFacilityDetailsCachePath();
  const mtimeMs = fileMtimeMs(cachePath);

  if (portalFacilityDetailsCache?.path === cachePath && portalFacilityDetailsCache.mtimeMs === mtimeMs) {
    return portalFacilityDetailsCache.value;
  }

  if (!existsSync(cachePath)) {
    portalFacilityDetailsCache = { path: cachePath, mtimeMs, value: [] };
    portalFacilityExportCache = null;
    portalFacilitySummaryCache = null;
    return [];
  }

  try {
    const raw = readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      portalFacilityDetailsCache = { path: cachePath, mtimeMs, value: parsed };
      portalFacilityExportCache = null;
      portalFacilitySummaryCache = null;
      return parsed;
    }
  } catch {
    // ignore invalid cache data
  }

  portalFacilityDetailsCache = { path: cachePath, mtimeMs, value: [] };
  portalFacilityExportCache = null;
  portalFacilitySummaryCache = null;
  return [];
}

function writePortalFacilityDetailsCache(records: PortalFacilityDetailRecord[]) {
  const cachePath = portalFacilityDetailsCachePath();
  ensureRuntimeDataDirForFile(cachePath);
  const tempPath = cachePath + ".tmp";
  writeFileSync(tempPath, JSON.stringify(records, null, 2), "utf8");
  renameSync(tempPath, cachePath);
  portalFacilityDetailsCache = { path: cachePath, mtimeMs: fileMtimeMs(cachePath), value: records };
  portalFacilityExportCache = null;
  portalFacilitySummaryCache = null;
}

function portalDetailCacheKey(record: Pick<PortalFacilityRecord, "category" | "facilityName" | "hefamaaId" | "renewalYear">) {
  return [record.hefamaaId, record.facilityName, record.category, record.renewalYear ?? ""]
    .map((value) => cleanPortalText(String(value)).toLowerCase())
    .join("|");
}

function portalDetailCacheMap(records = readPortalFacilityDetailsCache()) {
  return new Map(records.map((record) => [record.cacheKey, record] as const));
}

function normalizedPortalIdentity(value: unknown) {
  return cleanPortalText(String(value ?? "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function portalDetailFacilityCode(detail: PortalFacilityDetailRecord) {
  return normalizedPortalIdentity(detail.hefamaaId || detail.visibleFields?.["HEFA NO"] || detail.fieldIndex?.["HEFA NO"] || detail.sourceRecord?.hefamaaId);
}

function portalDetailNameKey(detail: PortalFacilityDetailRecord) {
  return normalizedPortalIdentity(detail.facilityName || detail.sourceRecord?.facilityName);
}

function portalExpectedFacilityCode(record: PortalFacilityRecord) {
  return normalizedPortalIdentity(record.hefamaaId || record.visibleFields?.["HEFA NO"] || record.visibleFields?.["Facility Code"]);
}

function portalExpectedNameKey(record: PortalFacilityRecord) {
  return normalizedPortalIdentity(record.facilityName);
}

function portalDetailHasCompleteBedData(detail?: PortalFacilityDetailRecord | null) {
  if (!detail) return false;
  const distribution = detail.bedDistribution ?? {};
  return [
    detail.admissionBeds ?? distribution.admissionBeds,
    detail.observationBeds ?? distribution.observationBeds,
    detail.couches ?? distribution.couches,
  ].every((value) => typeof value === "number");
}

function portalDetailHasAnyBedData(detail?: PortalFacilityDetailRecord | null) {
  if (!detail) return false;
  const distribution = detail.bedDistribution ?? {};
  return [
    detail.admissionBeds ?? distribution.admissionBeds,
    detail.observationBeds ?? distribution.observationBeds,
    detail.couches ?? distribution.couches,
  ].some((value) => typeof value === "number");
}

function upsertPortalDetailRecord(records: PortalFacilityDetailRecord[], detail: PortalFacilityDetailRecord, expectedRecord: PortalFacilityRecord) {
  const expectedCode = portalExpectedFacilityCode(expectedRecord) || portalDetailFacilityCode(detail);
  const expectedPortalId = normalizedPortalIdentity(expectedRecord.hefamaaId || detail.hefamaaId);
  const expectedName = portalExpectedNameKey(expectedRecord) || portalDetailNameKey(detail);

  const index = records.findIndex((existing) => {
    if (existing.cacheKey && existing.cacheKey === detail.cacheKey) return true;

    const existingCode = portalDetailFacilityCode(existing);
    if (expectedCode && existingCode && expectedCode === existingCode) return true;

    const existingPortalId = normalizedPortalIdentity(existing.hefamaaId || existing.sourceRecord?.hefamaaId);
    if (expectedPortalId && existingPortalId && expectedPortalId === existingPortalId) return true;

    const existingName = portalDetailNameKey(existing);
    return Boolean(expectedName && existingName && expectedName === existingName);
  });

  if (index >= 0) {
    records[index] = detail;
    return { records, recaptured: true };
  }

  records.push(detail);
  return { records, recaptured: false };
}

function lastDetailCapturedAt(records: PortalFacilityDetailRecord[]) {
  return records.reduce<string | null>((latest, record) => {
    if (!record.capturedAt) return latest;
    return latest === null || record.capturedAt > latest ? record.capturedAt : latest;
  }, null);
}

function addDetailField(fields: Record<string, string>, label: unknown, value: unknown) {
  const cleanLabel = cleanPortalText(String(label ?? ""));
  const cleanValue = cleanPortalText(String(value ?? ""));
  if (!cleanLabel || !cleanValue) return;
  fields[cleanLabel] = cleanValue;
}


const PORTAL_DETAIL_FIELD_ALIASES: Record<string, string[]> = {
  "Facility Name": ["facility name", "name of facility", "organisation name", "organization name"],
  "HEFA NO": ["hef/no", "hef no", "hefa no", "hefamaa no", "hefa number", "facility code", "facility id", "registration number", "permit number"],
  "Portal Facility ID": ["portal facility id", "portal id", "application id", "facility id", "hf id"],
  "Facility Sector": ["facility sector", "sector"],
  "Facility Category": ["facility category", "category", "facility type", "type of facility"],
  "Registration Status": ["registration status", "approval status", "application status", "status"],
  "Registration Type": ["registration type", "application type", "type of registration"],
  "Registration/Renewal Year": ["registration year", "renewal year", "year", "application year"],
  "Current Workflow Status": ["current workflow status", "workflow status", "current status", "status"],
  "CAC Number": ["cac number", "cac no", "cac registration number", "registration certificate number"],
  "Multiple Branches": ["multiple branches", "branch", "branches", "annex"],
  "Phone Number": ["phone number", "phone", "telephone", "contact", "mobile", "facility phone", "facility contact"],
  "Email Address": ["email address", "email", "e-mail", "mail", "facility email"],
  "Physical Address": ["physical address", "address", "facility address", "location address", "practice address"],
  LGA: ["lga", "local government", "local government area"],
  LCDA: ["lcda", "local council development area"],
  "Closest Landmark": ["closest landmark", "landmark", "nearest landmark"],
  "GPS Coordinates": ["gps coordinates", "gps", "coordinates", "latitude", "longitude"],
  "Building Type": ["building type", "type of building"],
  "Other Uses of Premises": ["other uses of premises", "other use of premises", "premises use", "other uses"],
  "Proprietor Name": ["proprietor name", "proprietor", "owner", "owner's name", "owners name"],
  "Proprietor Address": ["proprietor address", "owner address", "owner's address", "owners address"],
  "Proprietor Nationality": ["proprietor nationality", "owner nationality", "nationality"],
  "Proprietor Occupation": ["proprietor occupation", "owner occupation", "occupation"],
  "Opening Time": ["opening time", "opening hour", "opening hours", "open time"],
  "Closing Time": ["closing time", "closing hour", "closing hours", "close time"],
  "Date of Establishment": ["date of establishment", "establishment date", "date established"],
  "Ambulance Service": ["ambulance service", "ambulance"],
  "Emergency Service": ["emergency service", "emergency"],
  "Scope of Services": ["scope of service", "scope of services", "services rendered", "service scope"],
  "Admission Beds": ["admission bed", "admission beds", "no of admission beds", "number of admission beds"],
  "Observation Beds": ["observation bed", "observation beds", "no of observation beds", "number of observation beds"],
  Couches: ["no of couches", "couches", "couch", "number of couches"],
  Toilets: ["toilets", "toilet", "number of toilets"],
  "Water Source": ["water source", "source of water", "water supply"],
  "Power Source": ["power source", "source of power", "electricity source", "power supply"],
  "Human Waste Disposal": ["human waste disposal", "sewage disposal", "waste disposal human"],
  "Refuse Disposal": ["refuse disposal", "solid waste disposal", "waste disposal refuse"],
  "Medical Waste Disposal": ["medical waste disposal", "clinical waste disposal", "healthcare waste disposal"],
  "Basic Protective Items": ["basic protective items", "protective items", "ppe", "personal protective equipment"],
  "Operating Officer Full Name": ["medical professional in charge", "medical officer in charge", "operating officer", "officer in charge", "professional in charge", "person in charge", "full name"],
  "Operating Officer Address": ["operating officer address", "medical professional in charge address", "officer in charge address", "professional in charge address"],
  "Operating Officer Nationality": ["operating officer nationality", "medical professional in charge nationality", "officer nationality"],
  "Operating Officer Qualifications": ["operating officer qualifications", "qualification", "qualifications", "medical professional qualification"],
  "Operating Officer Registration Number": ["operating officer registration number", "registration number", "registration no", "reg no", "folio number", "license number", "licence number"],
  "Operating Officer Registration Year": ["operating officer registration year", "registration year", "year registered"],
  "Operating Officer Institution": ["operating officer institution", "institution", "school", "institution attended"],
  "Operating Officer Regulatory Authority": ["operating officer regulatory authority", "regulatory authority", "professional body", "council"],
  "Hospital Attendants": ["hospital attendants", "hospital attendant", "attendants"],
  "Administrative Staff": ["administrative staff", "admin staff", "administrators"],
  "Security Staff": ["security staff", "security", "security guards"],
  "Other Non Professional Staff": ["other non professional staff", "others", "other staff"],
  Queries: ["queries", "query", "query reason", "query details"],
  "Document Query": ["document query", "documents queried", "document queried", "queried document"],
  "Upload Payment/Document Approval Pending": ["upload payment/document approval pending", "upload payment and pending document approval", "upload payment pending document approval"],
  "Payment Approved/Document Approval Pending": ["payment approved/document approval pending", "payment approved and pending document approval", "payment approved pending document approval"],
  "Document Approved/Inspection Report Pending": ["document approved/inspection report pending", "document approved inspection report pending", "document approved inspection reporting pending"],
  "Inspection Report Upload/Inspection Approval Pending": ["inspection report upload/inspection approval pending", "inspection report upload pending approval", "inspection approval pending"],
  "Final Approval Pending": ["final approval pending"],
  "Registration Approved Date": ["registration approved date", "approval date", "approved date"],
  "Last Activity Date": ["last activity date", "last activity", "activity date"],
};

const REQUIRED_DETAIL_FIELD_ALIASES: Record<string, string[]> = PORTAL_DETAIL_FIELD_ALIASES;

function normalizeRequiredDetailLabel(value: string) {
  return cleanPortalText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findFieldValueByAliases(fields: Record<string, string>, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeRequiredDetailLabel).filter(Boolean);
  for (const [label, value] of Object.entries(fields)) {
    const normalizedLabel = normalizeRequiredDetailLabel(label);
    if (!normalizedLabel) continue;
    if (normalizedAliases.some((alias) => normalizedLabel === alias || normalizedLabel.includes(alias) || alias.includes(normalizedLabel))) {
      const cleanValue = cleanPortalText(value);
      if (cleanValue) return cleanValue;
    }
  }
  return "";
}


function parsePortalBedNumber(value: unknown) {
  const text = cleanPortalText(String(value ?? ""));
  if (!text || /^(n\/?a|not applicable|null|nil|none|-|—)$/i.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function bedDistributionFromFields(fields: Record<string, string>): PortalBedDistribution {
  return {
    admissionBeds: parsePortalBedNumber(fields["Admission Beds"]),
    observationBeds: parsePortalBedNumber(fields["Observation Beds"]),
    couches: parsePortalBedNumber(fields.Couches),
  };
}

function missingBedReasons(distribution: PortalBedDistribution) {
  return Object.entries(distribution)
    .filter(([, value]) => value === null)
    .map(([key]) => key);
}

function captureRequiredFacilityFields(input: {
  bodyText: string;
  formFields: VisibleFormField[];
  sourceRecord: PortalFacilityRecord;
}) {
  const formFieldMap: Record<string, string> = Object.fromEntries(input.formFields.map((field) => [field.label, field.value]));
  const sourceFields = input.sourceRecord.visibleFields ?? {};
  const requiredFields: Record<string, string> = {};

  for (const [canonicalLabel, aliases] of Object.entries(REQUIRED_DETAIL_FIELD_ALIASES)) {
    const value =
      findFieldValueByAliases(formFieldMap, aliases) ||
      findFieldValueByAliases(sourceFields, aliases) ||
      textValueByLabel(input.bodyText, aliases.map((alias) => alias.replace(/\b\w/g, (letter) => letter.toUpperCase())));
    if (value) requiredFields[canonicalLabel] = value;
  }

  requiredFields["Facility Name"] ||= cleanPortalText(input.sourceRecord.facilityName);
  requiredFields["HEFA NO"] ||= cleanPortalText(input.sourceRecord.hefamaaId) || extractHefamaaIdFromText(input.bodyText);
  requiredFields.Category ||= cleanPortalText(input.sourceRecord.category);
  requiredFields.Status ||= cleanPortalText(input.sourceRecord.registrationStatus);

  return requiredFields;
}

function buildDetailFieldIndex(input: {
  bodyText: string;
  formFields: VisibleFormField[];
  sourceRecord: PortalFacilityRecord;
  tables: string[][][];
}) {
  const fields: Record<string, string> = {};

  for (const [label, value] of Object.entries(input.sourceRecord.visibleFields ?? {})) {
    addDetailField(fields, label, value);
  }

  for (const field of input.formFields) {
    addDetailField(fields, field.label, field.value);
  }

  input.tables.forEach((table, tableIndex) => {
    table.forEach((row, rowIndex) => {
      const cells = row.map((cell) => cleanPortalText(cell)).filter(Boolean);
      if (cells.length === 2) {
        addDetailField(fields, cells[0], cells[1]);
      } else if (cells.length > 2 && cells.length <= 8) {
        cells.forEach((cell, cellIndex) => {
          addDetailField(fields, "Table " + (tableIndex + 1) + " Row " + (rowIndex + 1) + " Column " + (cellIndex + 1), cell);
        });
      }
    });
  });

  return fields;
}

function detailValue(fields: Record<string, string>, label: string) {
  return findFieldValueByAliases(fields, PORTAL_DETAIL_FIELD_ALIASES[label] ?? [label]);
}


function parsePortalApprovalDateValue(value: unknown) {
  const text = cleanPortalText(String(value ?? "")).replace(/(\d+)(st|nd|rd|th)\b/gi, "$1").replace(/,/g, " ");
  if (!text || /^(n\/?a|not applicable|null|nil|none|-|—)$/i.test(text)) return null;
  const numeric = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (numeric) {
    let first = Number(numeric[1]);
    let second = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())).toISOString();
  const yearOnly = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearOnly) return new Date(Date.UTC(Number(yearOnly[1]), 0, 1)).toISOString();
  return null;
}

function registrationApprovalInfo(workflow: PortalWorkflowDetails, sourceRecord: PortalFacilityRecord, capturedAt: string) {
  const candidates = [
    { source: "registrationApprovedDate", value: workflow.registrationApprovedDate },
    { source: "approvalDate", value: workflow.registrationApprovedDate },
    { source: "lastActivityDate", value: workflow.lastActivityDate },
    { source: "registrationDate", value: sourceRecord.recordDate },
    { source: "capturedAt", value: capturedAt },
  ];
  for (const candidate of candidates) {
    const parsed = parsePortalApprovalDateValue(candidate.value);
    if (!parsed) continue;
    const fallback = candidate.source === "capturedAt";
    return {
      approvalDateSource: candidate.source,
      approvalDateWarning: fallback ? "Approval date was not visible; captured/scanned date is retained only as a fallback and excluded from monthly/yearly approval trends." : null,
      approvalMonth: fallback ? null : parsed.slice(0, 7),
      approvalYear: fallback ? null : parsed.slice(0, 4),
      registrationApprovedAt: parsed,
    };
  }
  return {
    approvalDateSource: null,
    approvalDateWarning: "Registration approved date was not captured from the portal.",
    approvalMonth: null,
    approvalYear: null,
    registrationApprovedAt: null,
  };
}

function parsePortalYear(value: unknown) {
  const match = cleanPortalText(String(value ?? "")).match(/\b(20\d{2}|19\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function parseNullablePortalNumber(value: unknown) {
  const parsed = parsePortalBedNumber(value);
  return parsed === null ? null : parsed;
}

function canonicalFieldEntries(fields: Record<string, string>) {
  return Object.fromEntries(
    Object.keys(PORTAL_DETAIL_FIELD_ALIASES).map((label) => [label, detailValue(fields, label)] as const),
  ) as Record<string, string>;
}

function buildIdentificationDetails(fields: Record<string, string>, sourceRecord: PortalFacilityRecord): PortalIdentificationDetails {
  const canonical = canonicalFieldEntries(fields);
  return {
    facilityName: canonical["Facility Name"] || sourceRecord.facilityName,
    facilityCode: canonical["HEFA NO"] || sourceRecord.hefamaaId,
    portalFacilityId: canonical["Portal Facility ID"] || sourceRecord.hefamaaId,
    facilitySector: canonical["Facility Sector"],
    facilityCategory: canonical["Facility Category"] || sourceRecord.category,
    registrationStatus: canonical["Registration Status"] || sourceRecord.registrationStatus,
    registrationType: canonical["Registration Type"] || sourceRecord.applicationType,
    registrationRenewalYear: parsePortalYear(canonical["Registration/Renewal Year"]) ?? sourceRecord.renewalYear,
    currentWorkflowStatus: canonical["Current Workflow Status"] || sourceRecord.registrationStatus,
  };
}

function buildFacilityDetails(fields: Record<string, string>): PortalFacilityDetails {
  return {
    cacNumber: detailValue(fields, "CAC Number"),
    multipleBranches: detailValue(fields, "Multiple Branches"),
    phoneNumber: detailValue(fields, "Phone Number"),
    emailAddress: detailValue(fields, "Email Address"),
    physicalAddress: detailValue(fields, "Physical Address"),
    lga: detailValue(fields, "LGA"),
    lcda: detailValue(fields, "LCDA"),
    closestLandmark: detailValue(fields, "Closest Landmark"),
    gpsCoordinates: detailValue(fields, "GPS Coordinates"),
    buildingType: detailValue(fields, "Building Type"),
    otherUsesOfPremises: detailValue(fields, "Other Uses of Premises"),
  };
}

function buildProprietorDetails(fields: Record<string, string>): PortalProprietorDetails {
  return {
    proprietorName: detailValue(fields, "Proprietor Name"),
    proprietorAddress: detailValue(fields, "Proprietor Address"),
    nationality: detailValue(fields, "Proprietor Nationality"),
    occupation: detailValue(fields, "Proprietor Occupation"),
  };
}

function buildOperationsDetails(fields: Record<string, string>): PortalOperationsDetails {
  return {
    openingTime: detailValue(fields, "Opening Time"),
    closingTime: detailValue(fields, "Closing Time"),
    dateOfEstablishment: detailValue(fields, "Date of Establishment"),
    ambulanceService: detailValue(fields, "Ambulance Service"),
    emergencyService: detailValue(fields, "Emergency Service"),
    scopeOfServices: detailValue(fields, "Scope of Services"),
  };
}

function buildFacilityResources(fields: Record<string, string>): PortalFacilityResources {
  return {
    toilets: detailValue(fields, "Toilets"),
    waterSource: detailValue(fields, "Water Source"),
    powerSource: detailValue(fields, "Power Source"),
    humanWasteDisposal: detailValue(fields, "Human Waste Disposal"),
    refuseDisposal: detailValue(fields, "Refuse Disposal"),
    medicalWasteDisposal: detailValue(fields, "Medical Waste Disposal"),
    basicProtectiveItems: detailValue(fields, "Basic Protective Items"),
  };
}

function buildOperatingOfficerDetails(fields: Record<string, string>): PortalOperatingOfficerDetails {
  return {
    fullName: detailValue(fields, "Operating Officer Full Name"),
    address: detailValue(fields, "Operating Officer Address"),
    nationality: detailValue(fields, "Operating Officer Nationality"),
    qualifications: detailValue(fields, "Operating Officer Qualifications"),
    registrationNumber: detailValue(fields, "Operating Officer Registration Number"),
    registrationYear: detailValue(fields, "Operating Officer Registration Year"),
    institution: detailValue(fields, "Operating Officer Institution"),
    regulatoryAuthority: detailValue(fields, "Operating Officer Regulatory Authority"),
  };
}

function buildNonProfessionalStaff(fields: Record<string, string>): PortalNonProfessionalStaff {
  return {
    hospitalAttendants: parseNullablePortalNumber(detailValue(fields, "Hospital Attendants")),
    administrativeStaff: parseNullablePortalNumber(detailValue(fields, "Administrative Staff")),
    securityStaff: parseNullablePortalNumber(detailValue(fields, "Security Staff")),
    others: detailValue(fields, "Other Non Professional Staff"),
  };
}

function buildWorkflowDetails(fields: Record<string, string>): PortalWorkflowDetails {
  return {
    queries: detailValue(fields, "Queries"),
    documentQuery: detailValue(fields, "Document Query"),
    uploadPaymentDocumentApprovalPending: detailValue(fields, "Upload Payment/Document Approval Pending"),
    paymentApprovedDocumentApprovalPending: detailValue(fields, "Payment Approved/Document Approval Pending"),
    documentApprovedInspectionReportPending: detailValue(fields, "Document Approved/Inspection Report Pending"),
    inspectionReportUploadInspectionApprovalPending: detailValue(fields, "Inspection Report Upload/Inspection Approval Pending"),
    finalApprovalPending: detailValue(fields, "Final Approval Pending"),
    registrationApprovedDate: detailValue(fields, "Registration Approved Date"),
    lastActivityDate: detailValue(fields, "Last Activity Date"),
  };
}

function tableHeaderIndex(headers: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeRequiredDetailLabel).filter(Boolean);
  return headers.findIndex((header) => {
    const normalized = normalizeRequiredDetailLabel(header);
    return normalizedAliases.some((alias) => normalized === alias || normalized.includes(alias) || alias.includes(normalized));
  });
}

function rowValueByHeader(headers: string[], row: string[], aliases: string[]) {
  const index = tableHeaderIndex(headers, aliases);
  return index >= 0 ? cleanPortalText(row[index]) : "";
}

function extractProfessionalStaffMembers(tables: string[][][]): PortalProfessionalStaffMember[] {
  const members: PortalProfessionalStaffMember[] = [];

  for (const table of tables) {
    const headers = (table[0] ?? []).map(cleanPortalText);
    const headerText = headers.join(" ").toLowerCase();
    const looksLikeStaffTable = /name/.test(headerText) && /(complement|employment|qualification|institution|registration|post qualification|profession|staff)/.test(headerText);
    if (!looksLikeStaffTable) continue;

    for (const row of table.slice(1)) {
      const values = row.map(cleanPortalText).filter(Boolean);
      if (!values.length) continue;
      const text = values.join(" | ");
      const member: PortalProfessionalStaffMember = {
        name: rowValueByHeader(headers, row, ["name", "full name", "staff name"]),
        complement: rowValueByHeader(headers, row, ["complement", "profession", "designation", "cadre"]),
        employmentType: rowValueByHeader(headers, row, ["employment type", "type of employment", "employment"]),
        qualification: rowValueByHeader(headers, row, ["qualification", "qualifications"]),
        institution: rowValueByHeader(headers, row, ["institution", "school", "institution attended"]),
        yearQualified: rowValueByHeader(headers, row, ["year qualified", "qualification year", "year"]),
        registrationNumber: rowValueByHeader(headers, row, ["registration number", "registration no", "reg no", "folio", "license", "licence"]),
        postQualification: rowValueByHeader(headers, row, ["post qualification", "post-qualification", "post qualification experience"]),
        text,
        values,
      };
      if (!member.name && values.length <= 2) continue;
      members.push(member);
    }
  }

  return members;
}

const DOCUMENT_ALIASES = [
  "CAC Registration Certificate",
  "Tax Clearance Certificate",
  "LAWMA Certificate",
  "HMIS Clearance",
  "Last Renewal Certificate",
  "Professional Association Letter",
];

function documentAvailability(text: string) {
  const normalized = normalizeRequiredDetailLabel(text);
  if (!normalized) return null;
  if (/not uploaded|missing|not available|pending|no file|absent/.test(normalized)) return false;
  if (/uploaded|available|approved|submitted|yes|view|download/.test(normalized)) return true;
  return null;
}

function extractDocumentStatuses(fields: Record<string, string>, tables: string[][][]): PortalDocumentStatus[] {
  const byName = new Map<string, PortalDocumentStatus>();
  const push = (name: string, status: string, text: string) => {
    const cleanName = cleanPortalText(name);
    const cleanStatus = cleanPortalText(status || text);
    if (!cleanName || !cleanStatus) return;
    byName.set(normalizeRequiredDetailLabel(cleanName), {
      name: cleanName,
      status: cleanStatus,
      available: documentAvailability(cleanStatus),
      text: cleanPortalText(text || cleanName + " " + cleanStatus),
    });
  };

  for (const label of DOCUMENT_ALIASES) {
    const value = findFieldValueByAliases(fields, [label]);
    if (value) push(label, value, label + ": " + value);
  }

  for (const table of tables) {
    const tableText = table.flat().join(" ").toLowerCase();
    if (!/(document|certificate|clearance|uploaded|lawma|hmis|cac|tax|renewal|association)/.test(tableText)) continue;
    const headers = (table[0] ?? []).map(cleanPortalText);
    const nameIndex = tableHeaderIndex(headers, ["document", "document name", "certificate", "requirement", "file"]);
    const statusIndex = tableHeaderIndex(headers, ["status", "availability", "uploaded", "approval", "remark"]);
    for (const row of table.slice(1)) {
      const values = row.map(cleanPortalText).filter(Boolean);
      if (!values.length) continue;
      const rowText = values.join(" | ");
      const name = nameIndex >= 0 ? row[nameIndex] : values.find((value) => /(certificate|clearance|document|lawma|hmis|cac|tax|renewal|association)/i.test(value)) ?? values[0];
      const status = statusIndex >= 0 ? row[statusIndex] : values.filter((value) => value !== name).join(" | ");
      push(name, status, rowText);
    }
  }

  return Array.from(byName.values());
}

function flattenObjectFields(prefix: string, value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [prefix + " " + key.replace(/[A-Z]/g, (letter) => " " + letter).replace(/^./, (letter) => letter.toUpperCase()).trim(), cleanPortalText(String(item ?? ""))] as const)
      .filter(([, item]) => item),
  );
}

function countStructuredCapturedFields(detail: Pick<PortalFacilityDetailRecord, "identification" | "facilityDetails" | "proprietorDetails" | "operations" | "facilityResources" | "operatingOfficer" | "nonProfessionalStaff" | "workflow" | "professionalStaff" | "documents" | "bedDistribution">) {
  let count = 0;
  const objects = [detail.identification, detail.facilityDetails, detail.proprietorDetails, detail.operations, detail.facilityResources, detail.operatingOfficer, detail.nonProfessionalStaff, detail.workflow, detail.bedDistribution];
  for (const object of objects) {
    for (const value of Object.values(object ?? {})) {
      if (typeof value === "number" || cleanPortalText(String(value ?? ""))) count += 1;
    }
  }
  count += detail.professionalStaff?.length ?? 0;
  count += detail.documents?.length ?? 0;
  return count;
}

function aggregateMissingFields(current: Record<string, number>, warnings: string[]) {
  for (const warning of warnings) {
    const label = warning.replace(/\s+not captured within timeout\.?$/i, "");
    current[label] = (current[label] ?? 0) + 1;
  }
  return current;
}

function numericDetailValue(fields: Record<string, string>, aliases: string[]) {
  for (const [label, value] of Object.entries(fields)) {
    const normalizedLabel = label.toLowerCase();
    if (!aliases.some((alias) => normalizedLabel.includes(alias))) continue;
    const numeric = Number(String(value).replace(/[^0-9.-]+/g, ""));
    if (Number.isFinite(numeric)) return Math.max(0, numeric);
  }
  return null;
}

function countStaffComplement(input: { bodyText: string; fieldIndex: Record<string, string>; tables: string[][][] }) {
  const result: Record<string, number> = {};

  for (const [label, aliases] of Object.entries(STAFF_COMPLEMENT_ALIASES)) {
    const directValue = numericDetailValue(input.fieldIndex, aliases);
    if (directValue !== null) {
      result[label] = directValue;
      continue;
    }

    let count = 0;
    for (const table of input.tables) {
      table.forEach((row, rowIndex) => {
        const rowText = row.join(" ").toLowerCase();
        const isLikelyHeader = rowIndex === 0 && /name|profession|designation|qualification|staff/.test(rowText);
        if (isLikelyHeader) return;
        if (aliases.some((alias) => rowText.includes(alias))) count += 1;
      });
    }
    result[label] = count;
  }

  result.Total = Object.entries(result)
    .filter(([label]) => label !== "Total")
    .reduce((total, [, count]) => total + count, 0);
  return result;
}

function extractStaffDetails(tables: string[][][]) {
  const aliasEntries = Object.entries(STAFF_COMPLEMENT_ALIASES).filter(([label]) => label !== "Total");
  const details: PortalStaffDetail[] = [];

  tables.forEach((table, tableIndex) => {
    const tableText = table.flat().map((cell) => cleanPortalText(cell)).join(" ").toLowerCase();
    const looksLikeStaffTable = /professional staff|staff complement|staff details|profession|designation|qualification/.test(tableText)
      && /name|profession|designation|qualification|staff/.test(tableText);

    table.forEach((row, rowIndex) => {
      const values = row.map((cell) => cleanPortalText(cell)).filter(Boolean);
      const rowText = values.join(" ").toLowerCase();
      const isLikelyHeader = rowIndex === 0 && /name|profession|designation|qualification|staff/.test(rowText);
      if (!values.length || isLikelyHeader) return;

      const matchedComplements = aliasEntries
        .filter(([, aliases]) => aliases.some((alias) => rowText.includes(alias)))
        .map(([label]) => label);

      // Staff tables can contain roles we have not named yet, so keep the whole row once the table itself is identified.
      if (!looksLikeStaffTable && !matchedComplements.length) return;

      details.push({
        matchedComplements: Array.from(new Set(matchedComplements)),
        rowIndex: rowIndex + 1,
        tableIndex: tableIndex + 1,
        text: values.join(" | "),
        values,
      });
    });
  });

  return details;
}

function formatStaffDetails(staffDetails: PortalStaffDetail[] = []) {
  return staffDetails.map((detail) => detail.text).filter(Boolean).join("\n");
}

function mergePortalFacilityRecordWithDetail(record: PortalFacilityRecord, detail?: PortalFacilityDetailRecord): PortalFacilityRecord {
  if (!detail) return record;

  const staffFields = Object.fromEntries(
    Object.entries(detail.staffComplement ?? {}).map(([label, value]) => ["No of " + label, String(value)]),
  );
  const staffDetailsText = formatStaffDetails(detail.staffDetails);
  const staffDetailFields: Record<string, string> = staffDetailsText
    ? {
        "Professional Staff Details": staffDetailsText,
        "Professional Staff Rows Captured": String(detail.staffDetails?.length ?? 0),
      }
    : {};

  return {
    ...record,
    visibleFields: {
      ...(record.visibleFields ?? {}),
      ...(detail.visibleFields ?? {}),
      ...(detail.fieldIndex ?? {}),
      ...staffFields,
      ...staffDetailFields,
      "Detail Captured At": detail.capturedAt,
      "Detail Source URL": detail.url,
    },
    text: [record.text, detail.text, staffDetailsText, detail.bodyText].filter(Boolean).join("\n"),
  };
}

function mergePortalFacilityDetails(records: PortalFacilityRecord[]) {
  const details = portalDetailCacheMap();
  return records.map((record) => mergePortalFacilityRecordWithDetail(record, details.get(portalDetailCacheKey(record))));
}

async function captureFacilityDetailRecord(page: Page, sourceRecord: PortalFacilityRecord): Promise<PortalFacilityDetailRecord> {
  await page.waitForLoadState("domcontentloaded", { timeout: Math.min(3_000, facilityNavigationTimeoutMs()) }).catch(() => undefined);
  await page.waitForSelector("body", { timeout: Math.min(3_000, facilityCaptureTimeoutMs()) });

  const [bodyText, formFields] = await Promise.all([
    getVisibleText(page),
    getVisibleFormFields(page),
  ]);
  const requiredFields = captureRequiredFacilityFields({ bodyText, formFields, sourceRecord });
  let bedDistribution = bedDistributionFromFields(requiredFields);

  // Tables contain optional deep sections such as professional staff. Reading only visible tables keeps
  // the normal path fast while preserving staff details whenever the portal has already exposed them.
  const tables = await getVisibleTables(page).catch(() => []);
  const fieldIndex = {
    ...requiredFields,
    ...buildDetailFieldIndex({ bodyText, formFields, sourceRecord, tables }),
  };
  const identification = buildIdentificationDetails(fieldIndex, sourceRecord);
  const facilityDetails = buildFacilityDetails(fieldIndex);
  const proprietorDetails = buildProprietorDetails(fieldIndex);
  const operations = buildOperationsDetails(fieldIndex);
  const facilityResources = buildFacilityResources(fieldIndex);
  const operatingOfficer = buildOperatingOfficerDetails(fieldIndex);
  const nonProfessionalStaff = buildNonProfessionalStaff(fieldIndex);
  const workflow = buildWorkflowDetails(fieldIndex);
  const professionalStaff = extractProfessionalStaffMembers(tables);
  const documents = extractDocumentStatuses(fieldIndex, tables);
  const captureWarnings = Object.keys(REQUIRED_DETAIL_FIELD_ALIASES)
    .filter((label) => !cleanPortalText(fieldIndex[label]) && !detailValue(fieldIndex, label))
    .map((label) => label + " not captured within timeout.");
  bedDistribution = bedDistributionFromFields({ ...fieldIndex, ...requiredFields });
  if (Object.values(bedDistribution).some((value) => value === null)) {
    console.info("[portal/scan] missing bed distribution data", {
      facilityName: sourceRecord.facilityName,
      hefamaaId: sourceRecord.hefamaaId,
      missingFields: missingBedReasons(bedDistribution),
      url: page.url(),
    });
  }
  const staffComplement = countStaffComplement({ bodyText, fieldIndex, tables });
  // Counts are useful for sheet columns, while staffDetails preserves the complete staff rows for AI answers and exports.
  const staffDetails = tables.length ? extractStaffDetails(tables) : [];
  const staffDetailsText = formatStaffDetails(staffDetails);
  const staffFields = Object.fromEntries(
    Object.entries(staffComplement).map(([label, value]) => ["No of " + label, String(value)]),
  );
  const staffDetailFields: Record<string, string> = staffDetailsText
    ? {
        "Professional Staff Details": staffDetailsText,
        "Professional Staff Rows Captured": String(staffDetails.length),
      }
    : {};
  const structuredFields = {
    ...flattenObjectFields("Identification", identification),
    ...flattenObjectFields("Facility", facilityDetails),
    ...flattenObjectFields("Proprietor", proprietorDetails),
    ...flattenObjectFields("Operations", operations),
    ...flattenObjectFields("Resources", facilityResources),
    ...flattenObjectFields("Operating Officer", operatingOfficer),
    ...flattenObjectFields("Non Professional Staff", nonProfessionalStaff),
    ...flattenObjectFields("Workflow", workflow),
    "Professional Staff Rows Captured": professionalStaff.length ? String(professionalStaff.length) : "",
    "Documents Captured": documents.length ? String(documents.length) : "",
  };
  const visibleFields = {
    ...(sourceRecord.visibleFields ?? {}),
    ...Object.fromEntries(formFields.map((field) => [field.label, field.value])),
    ...fieldIndex,
    ...structuredFields,
    ...staffFields,
    ...staffDetailFields,
    ...(captureWarnings.length ? { "Capture Warnings": captureWarnings.join("; ") } : {}),
  };
  const text = [buildPortalSnapshotText({ bodyText, formFields, tables }), staffDetailsText].filter(Boolean).join("\n");
  const capturedAt = new Date().toISOString();
  const approvalInfo = registrationApprovalInfo(workflow, sourceRecord, capturedAt);

  return {
    admissionBeds: bedDistribution.admissionBeds,
    applicationType: sourceRecord.applicationType,
    bedDistribution,
    bodyText,
    cacheKey: portalDetailCacheKey(sourceRecord),
    couches: bedDistribution.couches,
    capturedAt,
    captureWarnings,
    category: sourceRecord.category,
    documents,
    facilityDetails,
    facilityName: sourceRecord.facilityName,
    facilityResources,
    fieldIndex,
    formFields,
    identification,
    hefamaaId: sourceRecord.hefamaaId,
    normalizedStatus: sourceRecord.normalizedStatus,
    nonProfessionalStaff,
    operatingOfficer,
    operations,
    observationBeds: bedDistribution.observationBeds,
    professionalStaff,
    proprietorDetails,
    recordDate: sourceRecord.recordDate ?? null,
    registrationStatus: sourceRecord.registrationStatus,
    renewalYear: sourceRecord.renewalYear,
    sourceRecord,
    staffComplement,
    staffDetails,
    tables,
    text,
    url: page.url(),
    visibleFields,
    workflow,
    ...approvalInfo,
  };
}

async function restoreFacilityGridAfterDetail(page: Page, beforeUrl: string, beforeFingerprint: string) {
  await page.keyboard.press("Escape").catch(() => undefined);
  const closeButtons = page.locator([
    'button:has-text("Close")',
    'a:has-text("Close")',
    '.modal button.close',
    '.modal .close',
    '[data-dismiss="modal"]',
    '[aria-label="Close"]',
  ].join(", "));
  const closeCount = await closeButtons.count().catch(() => 0);
  for (let index = 0; index < Math.min(closeCount, 2); index += 1) {
    const button = closeButtons.nth(index);
    if (await button.isVisible().catch(() => false)) {
      await button.click({ timeout: 800 }).catch(() => undefined);
      await page.waitForFunction(() => !document.querySelector(".modal.show,.modal-dialog,[role=dialog]"), null, { timeout: 500 }).catch(() => undefined);
      break;
    }
  }

  const hasGrid = await page.locator("#mainGrid").count().catch(() => 0);
  const currentFingerprint = hasGrid ? await facilityTableFingerprint(page).catch(() => "") : "";
  if (hasGrid && (!beforeFingerprint || currentFingerprint)) return;

  if (page.url() !== beforeUrl) {
    await page.goBack({ waitUntil: "domcontentloaded", timeout: 2_500 }).catch(() => undefined);
  }

  // Keep this step opportunistic. If the grid is not ready quickly, the next search
  // cycle will reopen the facilities grid instead of blocking every capture here.
  await getFacilitiesGridReadiness(page, 1_500).catch(() => undefined);
}


function normalizePortalMatchValue(value: string | null | undefined) {
  return cleanPortalText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function portalRecordMatchScore(expected: PortalFacilityRecord, row: FacilitySearchResultRow) {
  const expectedId = normalizePortalMatchValue(expected.hefamaaId);
  const rowId = normalizePortalMatchValue(row.hefamaaId);
  const expectedName = normalizePortalMatchValue(expected.facilityName);
  const rowName = normalizePortalMatchValue(row.facilityName);
  const expectedCategory = normalizePortalMatchValue(expected.category);
  const rowCategory = normalizePortalMatchValue(row.category);
  let score = 0;

  if (expectedId && rowId) {
    if (expectedId === rowId) score += 1000;
    else if (expectedId.includes(rowId) || rowId.includes(expectedId)) score += 180;
    else score -= 120;
  }

  if (expectedName && rowName) {
    if (expectedName === rowName) score += 240;
    else if (expectedName.includes(rowName) || rowName.includes(expectedName)) score += 80;
  }

  if (expectedCategory && rowCategory) {
    if (expectedCategory === rowCategory) score += 80;
    else score -= 30;
  }

  if (expected.renewalYear && row.renewalYear) {
    if (expected.renewalYear === row.renewalYear) score += 160;
    else score -= Math.min(120, Math.abs(expected.renewalYear - row.renewalYear) * 25);
  }

  if (!expectedId && !expectedName) return Number.NEGATIVE_INFINITY;
  return score;
}

function latestValidPortalRowScore(expected: PortalFacilityRecord, row: FacilitySearchResultRow) {
  const expectedStableId = stablePortalIdKey(expected.hefamaaId);
  const rowStableId = stablePortalIdKey(row.hefamaaId);
  const expectedFamily = facilityRecordFamilyKey(expected);
  const rowFamily = facilityRecordFamilyKey(row);
  const expectedCategory = normalizePortalMatchValue(expected.category);
  const rowCategory = normalizePortalMatchValue(row.category);
  const expectedName = normalizePortalMatchValue(expected.facilityName);
  const rowName = normalizePortalMatchValue(row.facilityName);
  let score = 0;

  if (expectedStableId && rowStableId && expectedStableId === rowStableId) score += 420;
  if (expectedFamily && rowFamily) {
    if (expectedFamily === rowFamily) score += 260;
    else if (expectedFamily.includes(rowFamily) || rowFamily.includes(expectedFamily)) score += 120;
  }
  if (expectedName && rowName) {
    if (expectedName === rowName) score += 160;
    else if (expectedName.includes(rowName) || rowName.includes(expectedName)) score += 80;
  }
  if (expectedCategory && rowCategory) score += expectedCategory === rowCategory ? 90 : -40;
  if (row.hasAction) score += 20;
  if (/approved|current|registered|final/i.test(row.registrationStatus)) score += 30;

  return score;
}

function selectLatestValidPortalRow(rows: FacilitySearchResultRow[], expected: PortalFacilityRecord) {
  const candidates = rows
    .map((row) => ({ row, score: latestValidPortalRowScore(expected, row) }))
    .filter((entry) => entry.score >= 140);

  if (!candidates.length) return null;

  return candidates.sort((a, b) => {
    const yearPriority = (b.row.renewalYear ?? 0) - (a.row.renewalYear ?? 0);
    const statusPriority = portalRecordStatusPriority(b.row) - portalRecordStatusPriority(a.row);
    const scorePriority = b.score - a.score;
    const datePriority = portalRecordDateTime(b.row) - portalRecordDateTime(a.row);
    return yearPriority || statusPriority || scorePriority || datePriority;
  })[0].row;
}

function selectExpectedPortalRow(rows: FacilitySearchResultRow[], expected: PortalFacilityRecord) {
  const scored = rows
    .map((row) => ({ row, score: portalRecordMatchScore(expected, row) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored[0]?.score >= 180) return scored[0].row;

  const latestValidRow = selectLatestValidPortalRow(rows, expected);
  if (latestValidRow) return latestValidRow;

  if (scored[0]) return scored[0].row;
  return rows.length === 1 ? rows[0] : null;
}

function mergeExpectedRecordWithPortalRow(expected: PortalFacilityRecord, selected: FacilitySearchResultRow): PortalFacilityRecord {
  const normalizedStatus = normalizePortalStatus(selected.registrationStatus || expected.registrationStatus, selected.renewalYear ?? expected.renewalYear);

  return {
    ...expected,
    index: selected.index,
    facilityName: expected.facilityName || selected.facilityName,
    hefamaaId: expected.hefamaaId || selected.hefamaaId,
    category: expected.category || selected.category,
    registrationStatus: selected.registrationStatus || expected.registrationStatus,
    recordDate: selected.recordDate ?? expected.recordDate ?? null,
    renewalYear: expected.renewalYear ?? selected.renewalYear,
    visibleFields: {
      ...(expected.visibleFields ?? {}),
      ...(selected.visibleFields ?? {}),
    },
    text: cleanPortalText([expected.text, selected.text].filter(Boolean).join("\n")),
    hasAction: selected.hasAction,
    applicationType: inferPortalApplicationType(selected, normalizedStatus),
    normalizedStatus,
    lastSeen: new Date().toISOString(),
  };
}

async function findExpectedPortalRowFromCachedPosition(page: Page, expected: PortalFacilityRecord) {
  const pageNumber = expected.portalPageNumber ? Math.max(1, Math.floor(expected.portalPageNumber)) : null;
  const rowNumber = expected.portalRowNumber ? Math.max(1, Math.floor(expected.portalRowNumber)) : null;

  if (!pageNumber || !rowNumber) return null;

  const positioned = await goToFacilityTablePage(page, pageNumber).catch(() => false);
  if (!positioned) return null;

  await waitForFacilityTableRows(page, facilityNavigationTimeoutMs());
  const rows = await getFacilityResultRows(page);
  const candidate = rows[rowNumber - 1];

  if (candidate && portalRecordMatchScore(expected, candidate) > 0) {
    return { query: "page " + pageNumber + ", row " + rowNumber, rows, selectedRow: candidate };
  }

  const selectedRow = selectExpectedPortalRow(rows, expected);
  return selectedRow ? { query: "page " + pageNumber, rows, selectedRow } : null;
}

async function searchExpectedPortalRecord(page: Page, expected: PortalFacilityRecord) {
  const queries = Array.from(new Set([expected.facilityName, expected.hefamaaId].map(cleanPortalText).filter(Boolean)));

  for (const query of queries) {
    let input = await openFacilitiesSearchPage(page);
    if (!input) {
      throw new Error("The HEFAMAA facility search input is not visible. Confirm you are logged in and the facilities table is open.");
    }

    const previousFingerprint = await facilityTableFingerprint(page).catch(() => "");
    let filled = await fillFacilitySearchInput(page, input, query);
    if (!filled) {
      await openFacilitiesGrid(page).catch(() => undefined);
      await prepareFacilityGridForFullScan(page).catch(() => undefined);
      input = await openFacilitiesSearchPage(page);
      filled = input ? await fillFacilitySearchInput(page, input, query) : false;
    }

    if (!filled || !input) {
      throw new Error("The HEFAMAA facility search input is visible but not editable. The grid was reopened and the scan will continue with the next facility.");
    }

    await input.press("Enter", { timeout: 1_000 }).catch(() => undefined);
    await clickSearchButtonIfAvailable(page);
    await waitForFacilitySearchResults(page, query, previousFingerprint);

    const rows = await getFacilityResultRows(page);
    const selectedRow = selectExpectedPortalRow(rows, expected);
    if (selectedRow) {
      return { query, rows, selectedRow };
    }
  }

  return null;
}

async function capturePortalFacilityDetails(
  page: Page,
  expectedRecords: PortalFacilityRecord[],
  options: { fresh?: boolean; onlyMissingBeds?: boolean; scanMode?: PortalScanMode } = {},
) {
  const existingDetails = readPortalFacilityDetailsCache();
  let detailRecords = [...existingDetails];
  let detailMap = portalDetailCacheMap(detailRecords);
  const recordsToCapture = expectedRecords.filter((record) => {
    const existing = detailMap.get(portalDetailCacheKey(record));
    if (!options.fresh) return !existing;
    if (!options.onlyMissingBeds) return true;
    return !portalDetailHasCompleteBedData(existing);
  });
  const cachedBeforeScan = expectedRecords.length - recordsToCapture.length;
  let scannedDetails = options.fresh ? 0 : cachedBeforeScan;
  let recapturedDetails = 0;
  let failedDetails = 0;
  let skippedDetails = 0;
  let bedsCapturedCount = 0;
  let missingBedDataCount = 0;
  let newFieldsCaptured = 0;
  let missingFields: Record<string, number> = {};
  let failedDueToTimeout = 0;
  let slowCaptures = 0;
  const captureTimings: Array<{ facilityName: string; seconds: number }> = [];
  const scanMode = options.scanMode ?? (options.fresh ? "fresh_full_scan" : "full");

  updatePortalScanProgress({
    bedsCapturedCount,
    openTabsCount: !page.isClosed() ? usablePages(page.context()).length : portalRuntime.scanProgress.openTabsCount,
    currentFacilityHefamaaId: null,
    currentFacilityName: null,
    detailTotal: recordsToCapture.length,
    failedDetails,
    lastCapturedFacilityName: null,
    message: options.fresh
      ? (options.onlyMissingBeds ? "Fresh bed-field recapture started for records missing admission beds, observation beds, or couches..." : "Fresh full detail scan started from the beginning. Existing cache records will be updated, not duplicated...")
      : "Capturing latest valid facility details for offline AI answers...",
    missingBedDataCount,
    onlyMissingBeds: Boolean(options.onlyMissingBeds),
    phase: "capturing_details",
    recapturedDetails,
    remainingDetails: Math.max(0, recordsToCapture.length - scannedDetails - skippedDetails - failedDetails),
    scannedDetails,
    skippedDetails,
    slowCaptures,
    speedAnalytics: updateSpeedAnalyticsFromTimings(captureTimings, failedDueToTimeout, Math.max(0, recordsToCapture.length - scannedDetails), slowCaptures),
  });

  if (!recordsToCapture.length) {
    updatePortalScanProgress({
      bedsCapturedCount,
      message: expectedRecords.length
        ? options.onlyMissingBeds
          ? "All cached latest facility records already have bed distribution data."
          : "All latest valid facility detail records are already cached; full scan reused the saved captures."
        : "No latest valid facility records were available for detail capture.",
      missingBedDataCount,
      recapturedDetails,
      scannedDetails,
    });
    return detailRecords;
  }

  throwIfPortalScanStopped();
  await openFacilitiesGrid(page);
  const gridReadiness = await getFacilitiesGridReadiness(page, facilityNavigationTimeoutMs());
  if (!gridReadiness.gridAttached && gridReadiness.rowCount <= 0) {
    throw new Error("The HEFAMAA facilities table is not ready on " + gridReadiness.pageTitle + " (" + gridReadiness.currentUrl + "). Open the Facilities page in the portal browser, then run Full Detail Scan again.");
  }
  await prepareFacilityGridForFullScan(page).catch(() => undefined);

  for (let recordIndex = 0; recordIndex < recordsToCapture.length; recordIndex += 1) {
    throwIfPortalScanStopped();
    if (isGracefulStopRequested()) {
      updatePortalScanProgress({
        completedAt: new Date().toISOString(),
        currentFacilityHefamaaId: null,
        currentFacilityName: null,
        message: "SCAN_STOPPED_BY_USER",
        status: "cancelled",
        stopRequested: true,
      });
      break;
    }
    const expectedRecord = recordsToCapture[recordIndex];
    const key = portalDetailCacheKey(expectedRecord);

    const facilityName = portalRecordDisplayName(expectedRecord);
    const detailIndex = recordIndex + 1;

    updateScanController({ currentFacility: facilityName });
    appendPortalScanEvent({
      category: expectedRecord.category,
      detailIndex,
      detailTotal: recordsToCapture.length,
      facilityName,
      hefamaaId: expectedRecord.hefamaaId,
      message: "Capturing " + facilityName + " now...",
      status: "capturing",
    });
    updatePortalScanProgress({
      currentFacilityHefamaaId: expectedRecord.hefamaaId || null,
      currentFacilityName: facilityName,
      detailTotal: recordsToCapture.length,
      failedDetails,
      message: "Capturing " + facilityName + " now...",
      phase: "capturing_details",
      remainingDetails: Math.max(0, recordsToCapture.length - scannedDetails - skippedDetails - failedDetails),
      scannedDetails,
      skippedDetails,
      slowCaptures,
    });

    const captureTimeoutMs = facilityCaptureTimeoutMs();
    const maxAttempts = facilityRetryLimit() + 1;
    let captured = false;
    let skipped = false;
    let lastError: unknown = null;
    let lastDurationMs = 0;

    for (let attempt = 1; attempt <= maxAttempts && !captured && !skipped; attempt += 1) {
      let beforeUrl = page.url();
      let beforeFingerprint = "";
      const attemptStartedAt = Date.now();

      try {
        throwIfPortalScanStopped();
        if (attempt > 1) {
          appendPortalScanEvent({
            attempt,
            category: expectedRecord.category,
            detailIndex,
            detailTotal: recordsToCapture.length,
            facilityName,
            hefamaaId: expectedRecord.hefamaaId,
            message: "Retrying " + facilityName + " after a slow or failed capture...",
            status: "capturing",
          });
        }

        const searchResult = await findExpectedPortalRowFromCachedPosition(page, expectedRecord)
          ?? await searchExpectedPortalRecord(page, expectedRecord);
        throwIfPortalScanStopped();
        if (!searchResult) {
          skippedDetails += 1;
          updateScanController({ skippedCount: skippedDetails });
          skipped = true;
          const position = detailPositionForIndex(detailIndex);
          recordPortalScanRecovery("skipped", {
            category: expectedRecord.category,
            facilityName,
            failureReason: "Exact latest valid portal row was not found",
            hefamaaId: expectedRecord.hefamaaId,
            portalPageNumber: position.portalPageNumber,
            portalRowNumber: position.portalRowNumber,
            retryAttempts: attempt - 1,
            status: "skipped",
            timestamp: new Date().toISOString(),
          });
          appendPortalScanEvent({
            attempt,
            category: expectedRecord.category,
            detailIndex,
            detailTotal: recordsToCapture.length,
            facilityName,
            hefamaaId: expectedRecord.hefamaaId,
            message: facilityName + " skipped because the exact latest valid portal row was not found.",
            status: "skipped",
          });
          updatePortalScanProgress({
            currentFacilityHefamaaId: null,
            currentFacilityName: null,
            failedDetails,
            message: facilityName + " was not found in portal search; moving to the next facility.",
            scannedDetails,
            skippedDetails,
            speedAnalytics: updateSpeedAnalyticsFromTimings(captureTimings, failedDueToTimeout, Math.max(0, recordsToCapture.length - scannedDetails - skippedDetails), slowCaptures),
          });
          break;
        }

        const sourceRecord = mergeExpectedRecordWithPortalRow(expectedRecord, searchResult.selectedRow);
        beforeUrl = page.url();
        beforeFingerprint = await facilityTableFingerprint(page).catch(() => "");

        const clicked = await openFacilityResult(page, searchResult.selectedRow.index).catch(() => false);
        throwIfPortalScanStopped();
        if (!clicked) {
          skippedDetails += 1;
          updateScanController({ skippedCount: skippedDetails });
          skipped = true;
          const position = detailPositionForIndex(detailIndex);
          recordPortalScanRecovery("skipped", {
            category: sourceRecord.category,
            facilityName,
            failureReason: "Portal row could not be opened",
            hefamaaId: sourceRecord.hefamaaId,
            portalPageNumber: position.portalPageNumber,
            portalRowNumber: position.portalRowNumber,
            retryAttempts: attempt - 1,
            status: "skipped",
            timestamp: new Date().toISOString(),
          });
          appendPortalScanEvent({
            attempt,
            category: sourceRecord.category,
            detailIndex,
            detailTotal: recordsToCapture.length,
            facilityName,
            hefamaaId: sourceRecord.hefamaaId,
            message: facilityName + " skipped because the portal row could not be opened.",
            status: "skipped",
          });
          updatePortalScanProgress({
            currentFacilityHefamaaId: null,
            currentFacilityName: null,
            failedDetails,
            message: facilityName + " could not be opened; moving to the next facility.",
            scannedDetails,
            skippedDetails,
            speedAnalytics: updateSpeedAnalyticsFromTimings(captureTimings, failedDueToTimeout, Math.max(0, recordsToCapture.length - scannedDetails - skippedDetails), slowCaptures),
          });
          break;
        }

        await waitForFacilityRecordReady(page, sourceRecord.facilityName || facilityName, Math.min(facilityNavigationTimeoutMs(), 8_000));
        const extractionStartedAt = Date.now();
        const detail = await captureFacilityDetailRecord(page, sourceRecord);
        throwIfPortalScanStopped();

        const totalDurationMs = Date.now() - attemptStartedAt;
        lastDurationMs = Date.now() - extractionStartedAt;
        const slowThresholdMs = facilitySlowCaptureThresholdMs();
        const slow = lastDurationMs > slowThresholdMs;
        if (slow) {
          slowCaptures += 1;
          const slowMessage = facilityName + " exceeded the " + (slowThresholdMs / 1000).toFixed(1) + "s capture target (" + (lastDurationMs / 1000).toFixed(1) + "s).";
          appendPortalScanEvent({
            attempt,
            category: sourceRecord.category,
            detailIndex,
            detailTotal: recordsToCapture.length,
            durationMs: lastDurationMs,
            facilityName,
            hefamaaId: sourceRecord.hefamaaId,
            message: attempt < maxAttempts ? slowMessage + " Retrying once before saving." : slowMessage + " Moving to failed scan queue.",
            status: attempt < maxAttempts ? "info" : "failed",
          });
          if (attempt < maxAttempts) {
            continue;
          }
          throw new Error(slowMessage);
        }

        const detailToSave: PortalFacilityDetailRecord = {
          ...detail,
          cacheKey: key,
          recapturedAt: options.fresh ? new Date().toISOString() : undefined,
          scanMode,
          sourceRecord,
        };
        const upserted = upsertPortalDetailRecord(detailRecords, detailToSave, sourceRecord);
        detailRecords = upserted.records;
        detailMap = portalDetailCacheMap(detailRecords);
        scannedDetails += 1;
        updateScanController({ capturedCount: scannedDetails });
        if (options.fresh || upserted.recaptured) recapturedDetails += 1;
        if (portalDetailHasAnyBedData(detailToSave)) bedsCapturedCount += 1;
        if (!portalDetailHasCompleteBedData(detailToSave)) missingBedDataCount += 1;
        writePortalFacilityDetailsCache(detailRecords);
        try {
          upsertPortalQaIndexDetail(detailToSave);
        } catch (indexError) {
          console.warn("[portal/scan] QA index update failed", scanErrorMessage(indexError));
        }
        newFieldsCaptured += countStructuredCapturedFields(detailToSave);
        missingFields = aggregateMissingFields(missingFields, detailToSave.captureWarnings ?? []);
        captureTimings.push({ facilityName, seconds: lastDurationMs / 1000 });
        captured = true;

        appendPortalScanEvent({
          attempt,
          category: sourceRecord.category,
          detailIndex,
          detailTotal: recordsToCapture.length,
          durationMs: lastDurationMs,
          facilityName,
          hefamaaId: sourceRecord.hefamaaId,
          message: facilityName + " captured successfully in " + (lastDurationMs / 1000).toFixed(1) + "s after page load (" + (totalDurationMs / 1000).toFixed(1) + "s total).",
          status: "captured",
        });
        updatePortalScanProgress({
          bedsCapturedCount,
          currentFacilityHefamaaId: null,
          currentFacilityName: null,
          detailTotal: recordsToCapture.length,
          failedDetails,
          lastCapturedFacilityName: facilityName,
          lastCaptureMs: lastDurationMs,
          message: facilityName + " captured successfully. Capturing next facility...",
          phase: "capturing_details",
          missingBedDataCount,
          recapturedDetails,
          remainingDetails: Math.max(0, recordsToCapture.length - scannedDetails - skippedDetails - failedDetails),
          scannedDetails,
          skippedDetails,
          slowCaptures,
          speedAnalytics: updateSpeedAnalyticsFromTimings(captureTimings, failedDueToTimeout, Math.max(0, recordsToCapture.length - scannedDetails - skippedDetails), slowCaptures),
        });
      } catch (error) {
        lastError = error;
        lastDurationMs = Date.now() - attemptStartedAt;
        if (isPortalScanCancellationError(error)) {
          throw new Error("Portal scan cancelled by user.");
        }

        if (page.isClosed() || isPortalTargetClosedError(error)) {
          throw new Error("Portal browser closed during full detail scan: " + scanErrorMessage(error));
        }

        const errorMessage = scanErrorMessage(error);
        const timeoutFailure = classifyDetailFailureReason(error, lastDurationMs, captureTimeoutMs) === "Portal timeout";
        appendPortalScanEvent({
          attempt,
          category: expectedRecord.category,
          detailIndex,
          detailTotal: recordsToCapture.length,
          durationMs: lastDurationMs,
          error: errorMessage,
          facilityName,
          hefamaaId: expectedRecord.hefamaaId,
          message: timeoutFailure
            ? facilityName + " exceeded the capture timeout; " + (attempt < maxAttempts ? "retrying once." : "moving to failed queue.")
            : facilityName + " capture attempt failed; " + (attempt < maxAttempts ? "retrying once." : "moving to failed queue."),
          status: attempt < maxAttempts ? "info" : "failed",
        });

        if (attempt < maxAttempts) {
          continue;
        }
      } finally {
        if (!isGracefulStopRequested() && !portalRuntime.scanStopRequested && !page.isClosed()) {
          await restoreFacilityGridAfterDetail(page, beforeUrl, beforeFingerprint).catch(async (restoreError) => {
            const errorMessage = scanErrorMessage(restoreError);
            if (isGracefulStopRequested() || portalRuntime.scanStopRequested || page.isClosed() || isPortalTargetClosedError(restoreError)) {
              return;
            }

            console.warn("[portal/scan] failed to restore facility grid", errorMessage);
            appendPortalScanEvent({
              error: errorMessage,
              message: "The portal grid needed recovery after " + facilityName + ". Reopening the facilities table.",
              status: "info",
            });
            await openFacilitiesGrid(page).catch(() => undefined);
            await getFacilitiesGridReadiness(page, facilityNavigationTimeoutMs()).catch(() => undefined);
          });
        }
      }
    }

    if (!captured && !skipped) {
      failedDetails += 1;
      updateScanController({ failedCount: failedDetails });
      const errorMessage = scanErrorMessage(lastError);
      const failureReason = classifyDetailFailureReason(lastError, lastDurationMs, captureTimeoutMs);
      if (failureReason === "Portal timeout") failedDueToTimeout += 1;
      const position = detailPositionForIndex(detailIndex);
      console.warn("[portal/scan] detail capture failed", { facilityName, hefamaaId: expectedRecord.hefamaaId, error: errorMessage, failureReason });
      recordPortalScanRecovery("failed", {
        category: expectedRecord.category,
        errorStack: lastError instanceof Error ? lastError.stack : undefined,
        facilityName,
        failureReason,
        hefamaaId: expectedRecord.hefamaaId,
        lastRetryTime: new Date().toISOString(),
        portalPageNumber: position.portalPageNumber,
        portalRowNumber: position.portalRowNumber,
        retryAttempts: Math.max(0, maxAttempts - 1),
        status: maxAttempts - 1 >= 3 ? "manual_review" : "failed",
        timestamp: new Date().toISOString(),
      });
      appendPortalScanEvent({
        attempt: maxAttempts,
        category: expectedRecord.category,
        detailIndex,
        detailTotal: recordsToCapture.length,
        durationMs: lastDurationMs,
        error: errorMessage,
        facilityName,
        hefamaaId: expectedRecord.hefamaaId,
        message: facilityName + " could not be captured; saved to failed scan queue and moving to the next facility.",
        status: "failed",
      });
      updatePortalScanProgress({
        bedsCapturedCount,
        currentFacilityHefamaaId: null,
        currentFacilityName: null,
        failedDetails,
        message: facilityName + " could not be captured. Continuing with the next facility.",
        missingBedDataCount,
        recapturedDetails,
        scannedDetails,
        skippedDetails,
        speedAnalytics: updateSpeedAnalyticsFromTimings(captureTimings, failedDueToTimeout, Math.max(0, recordsToCapture.length - scannedDetails - skippedDetails), slowCaptures),
      });
    }

    if (!page.isClosed()) {
      await closeExtraBlankTabs(page.context(), page).catch(() => undefined);
    }
    updateScanController({ currentFacility: null });
    if (isGracefulStopRequested()) {
      appendPortalScanEvent({
        message: "SCAN_STOPPED_BY_USER",
        status: "info",
      });
      updatePortalScanProgress({
        completedAt: new Date().toISOString(),
        currentFacilityHefamaaId: null,
        currentFacilityName: null,
        message: "SCAN_STOPPED_BY_USER",
        status: "cancelled",
        stopRequested: true,
      });
      break;
    }
  }

  writePortalFacilityDetailsCache(detailRecords);
  const startedAtMs = portalRuntime.scanProgress.startedAt ? Date.parse(portalRuntime.scanProgress.startedAt) : Number.NaN;
  const totalScanTimeSeconds = Number.isFinite(startedAtMs) ? Math.max(0, (Date.now() - startedAtMs) / 1000) : null;
  const averageCaptureTimeSeconds = captureTimings.length
    ? captureTimings.reduce((total, item) => total + item.seconds, 0) / captureTimings.length
    : null;
  updatePortalScanProgress({
    bedsCapturedCount,
    currentFacilityHefamaaId: null,
    currentFacilityName: null,
    failedDetails,
    missingBedDataCount,
    recapturedDetails,
    remainingDetails: Math.max(0, recordsToCapture.length - scannedDetails - skippedDetails - failedDetails),
    scanCompletionReport: {
      averageCaptureTimeSeconds,
      failedFacilities: failedDetails,
      facilitiesUpdated: scannedDetails,
      missingFields,
      newFieldsCaptured,
      skippedFacilities: skippedDetails,
      totalScanTimeSeconds,
    },
    scannedDetails,
    skippedDetails,
    slowCaptures,
    stopRequested: isGracefulStopRequested(),
  });
  return detailRecords;
}

function parseDateString(value: string | null | undefined) {
  if (!value) return null;
  const normalized = String(value).trim().replace(/-/g, "/");
  const parts = normalized.split("/");

  if (parts.length !== 3) {
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  let [part1, part2, part3] = parts.map((part) => part.trim());
  if (!part1 || !part2 || !part3) return null;

  let day = Number(part1);
  let month = Number(part2);
  let year = Number(part3);

  if (year < 100) {
    year += year < 50 ? 2000 : 1900;
  }

  if (month > 12 && day <= 12) {
    [day, month] = [month, day];
  }

  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12 && year >= 1900)) {
    return null;
  }

  return new Date(year, month - 1, day);
}

function summarizeStatus(records: PortalFacilityRecord[]) {
  return records.reduce<Record<PortalFacilityStatus, number>>((acc, record) => {
    const status = record.normalizedStatus || "unknown_status";
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {
    document_queried: 0,
    payment_queried: 0,
    upload_payment_pending_document_approval: 0,
    payment_approved_pending_document_approval: 0,
    document_approved_inspection_pending: 0,
    inspection_report_upload_pending_approval: 0,
    final_approval_pending: 0,
    registration_approved: 0,
    waiting_to_onboard: 0,
    unknown_status: 0,
  });
}

function applicationTypeForRecord(record: PortalFacilityRecord) {
  return record.applicationType || inferPortalApplicationType(record, record.normalizedStatus || normalizePortalStatus(record.registrationStatus, record.renewalYear));
}

function countByMonth(records: PortalFacilityRecord[], applicationType?: PortalApplicationType) {
  const counts: Record<string, number> = {};

  for (const record of records) {
    if (applicationType && applicationTypeForRecord(record) !== applicationType) continue;

    const date = parseDateString(record.recordDate);
    if (!date) continue;

    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    counts[month] = (counts[month] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
}

function countByCategory(records: PortalFacilityRecord[]) {
  const counts: Record<string, number> = {};

  for (const record of records) {
    const category = cleanPortalText(record.category) || "Uncategorised";
    counts[category] = (counts[category] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort(([, leftCount], [, rightCount]) => rightCount - leftCount)
    .map(([category, count]) => ({ category, count }));
}

function countByApplicationType(records: PortalFacilityRecord[]) {
  return records.reduce<Record<PortalApplicationType, number>>((acc, record) => {
    acc[applicationTypeForRecord(record)] += 1;
    return acc;
  }, {
    new_registration: 0,
    renewal: 0,
    unknown: 0,
  });
}

function countByYear(records: PortalFacilityRecord[], applicationType?: PortalApplicationType) {
  const counts: Record<number, number> = {};

  for (const record of records) {
    if (applicationType && applicationTypeForRecord(record) !== applicationType) continue;

    if (record.renewalYear) {
      counts[record.renewalYear] = (counts[record.renewalYear] ?? 0) + 1;
    }
  }

  return Object.entries(counts)
    .map(([year, count]) => ({ year: Number(year), count }))
    .sort((a, b) => a.year - b.year);
}

function dedupeFacilityRecords(records: PortalFacilityRecord[]) {
  const seen = new Map<string, PortalFacilityRecord>();

  for (const record of records) {
    const key = `${record.hefamaaId || ""}|${record.facilityName}|${record.registrationStatus}|${record.renewalYear ?? ""}`;
    if (!seen.has(key)) {
      seen.set(key, record);
    }
  }

  return Array.from(seen.values());
}

function portalScanListProgressPath() {
  return configuredRuntimeFile("HEFAMAA_PORTAL_LIST_PROGRESS", "portal-list-scan-progress.json");
}

type PortalListScanProgressFile = {
  completed: boolean;
  mode: PortalScanMode;
  pageNumber: number;
  rowNumber: number;
  savedAt: string;
};

function readPortalListScanProgress(): PortalListScanProgressFile | null {
  const progressPath = portalScanListProgressPath();
  if (!existsSync(progressPath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(progressPath, "utf8"));
    if (parsed && typeof parsed === "object") {
      const pageNumber = Number(parsed.pageNumber);
      const rowNumber = Number(parsed.rowNumber);
      if (Number.isFinite(pageNumber) && Number.isFinite(rowNumber)) {
        return {
          completed: Boolean(parsed.completed),
          mode: ["quick", "full", "fresh_full_scan"].includes(String(parsed.mode)) ? parsed.mode : "quick",
          pageNumber: Math.max(1, Math.floor(pageNumber)),
          rowNumber: Math.max(1, Math.floor(rowNumber)),
          savedAt: cleanPortalText(parsed.savedAt) || new Date().toISOString(),
        };
      }
    }
  } catch {
    // Invalid progress files are ignored so a new scan can start cleanly.
  }

  return null;
}

function writePortalListScanProgress(progress: PortalListScanProgressFile) {
  const progressPath = portalScanListProgressPath();
  ensureRuntimeDataDirForFile(progressPath);
  writeFileSync(progressPath, JSON.stringify(progress, null, 2), "utf8");
}

function clearPortalListScanProgress() {
  const progressPath = portalScanListProgressPath();
  if (existsSync(progressPath)) {
    rmSync(progressPath, { force: true });
  }
}

function portalListRecordKey(record: Pick<PortalFacilityRecord, "facilityName" | "hefamaaId" | "registrationStatus" | "renewalYear">) {
  const code = normalizePortalMatchValue(record.hefamaaId);
  if (code) return "code:" + code;
  const name = normalizePortalMatchValue(record.facilityName);
  const status = normalizePortalMatchValue(record.registrationStatus);
  const year = cleanPortalText(record.renewalYear == null ? "" : String(record.renewalYear));
  return ["row", name, status, year].join(":");
}

function upsertPortalFacilityRecord(records: PortalFacilityRecord[], record: PortalFacilityRecord) {
  const key = portalListRecordKey(record);
  const existingIndex = records.findIndex((item) => portalListRecordKey(item) === key);
  if (existingIndex >= 0) {
    records[existingIndex] = { ...records[existingIndex], ...record };
    return records;
  }

  records.push(record);
  return records;
}

async function waitForFacilityTableRows(page: Page, timeout = facilityNavigationTimeoutMs()) {
  await page.locator("#mainGrid, table#mainGrid, table.dataTable").first().waitFor({ state: "attached", timeout }).catch(() => undefined);
  await waitForDataTableIdle(page, Math.min(timeout, 2_000)).catch(() => undefined);
  await page.locator("#mainGrid tbody tr, table.dataTable tbody tr, .dataTable tbody tr").first().waitFor({ state: "attached", timeout }).catch(() => undefined);

  return page.evaluate(() => {
    const selectors = ["#mainGrid tbody tr", "table#mainGrid tbody tr", "table.dataTable tbody tr", ".dataTable tbody tr"];
    for (const selector of selectors) {
      const rows = Array.from(document.querySelectorAll(selector));
      const usableRows = rows.filter((row) => !/no matching|no data available/i.test(row.textContent || ""));
      if (usableRows.length) return usableRows.length;
    }
    return 0;
  }).catch(() => 0);
}

async function currentFacilityTablePageNumber(page: Page) {
  const pageFromActiveButton = await page.evaluate(() => {
    const active = document.querySelector("#mainGrid_paginate .paginate_button.active a, #mainGrid_paginate .paginate_button.active");
    const value = active?.textContent?.replace(/\D+/g, "") || "";
    return value ? Number(value) : null;
  }).catch(() => null);
  if (pageFromActiveButton && Number.isFinite(pageFromActiveButton)) return pageFromActiveButton;

  const info = await page.locator("#mainGrid_info").innerText().catch(() => "");
  const showing = info.match(/Showing\s+([\d,]+)\s+to\s+([\d,]+)/i);
  if (!showing) return 1;
  const start = Number(showing[1].replace(/,/g, ""));
  const end = Number(showing[2].replace(/,/g, ""));
  const pageSize = Math.max(1, end - start + 1);
  return Math.max(1, Math.ceil(start / pageSize));
}

async function goToFacilityTablePage(page: Page, targetPageNumber: number) {
  const safeTarget = Math.max(1, Math.floor(targetPageNumber));
  await openFacilitiesGrid(page);
  await waitForFacilityTableRows(page, facilityNavigationTimeoutMs());

  for (let guard = 0; guard < 600; guard += 1) {
    const currentPage = await currentFacilityTablePageNumber(page);
    if (currentPage === safeTarget) return true;

    if (currentPage > safeTarget) {
      await prepareFacilityGridForFullScan(page).catch(() => undefined);
      const afterReset = await currentFacilityTablePageNumber(page);
      if (afterReset === safeTarget) return true;
      if (afterReset > safeTarget) return false;
    }

    const fingerprint = await facilityTableFingerprint(page);
    const moved = await clickNextFacilityPage(page, fingerprint);
    if (!moved) return false;
    await waitForFacilityTableRows(page, facilityNavigationTimeoutMs());
  }

  return false;
}

async function facilityTableFingerprint(page: Page) {
  return page.locator("#mainGrid tbody").innerText().catch(() => "");
}

async function readPortalReportedRecordCount(page: Page) {
  const info = await page.locator("#mainGrid_info").innerText().catch(() => "");
  const match = info.match(/of\s+([\d,]+)\s+entries/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

async function prepareFacilityGridForFullScan(page: Page) {
  const lengthSelector = page.locator('select[name="mainGrid_length"]');
  if (await lengthSelector.count()) {
    const changedPageLength = await lengthSelector
      .selectOption("100", { timeout: 3_000 })
      .then(() => true)
      .catch(async () => {
        return page.evaluate(() => {
          const select = document.querySelector<HTMLSelectElement>('select[name="mainGrid_length"]');
          if (!select) return false;
          select.value = "100";
          select.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        }).catch(() => false);
      });

    if (changedPageLength) {
      await page.waitForFunction(() => document.querySelectorAll("#mainGrid tbody tr").length >= 50 || !document.querySelector("#mainGrid_next:not(.disabled)"), null, { timeout: facilityNavigationTimeoutMs() }).catch(() => undefined);
      await page.waitForFunction(() => {
        const processing = document.querySelector<HTMLElement>("#mainGrid_processing");
        return !processing || processing.style.display === "none";
      }, null, { timeout: facilityNavigationTimeoutMs() }).catch(() => undefined);
    }
  }

  const info = await page.locator("#mainGrid_info").innerText().catch(() => "");
  if (!/Showing\s+1\s+to/i.test(info)) {
    const firstPage = page.locator("#mainGrid_paginate .paginate_button:not(.previous):not(.next) a").first();
    if (await firstPage.count()) {
      await firstPage.click();
      await page.waitForFunction(() => /Showing\s+1\s+to/i.test(document.querySelector("#mainGrid_info")?.textContent ?? ""), null, { timeout: facilityNavigationTimeoutMs() }).catch(() => undefined);
    }
  }
}

async function clickNextFacilityPage(page: Page, currentFingerprint: string) {
  const next = page.locator("#mainGrid_next:not(.disabled) a");
  if (!(await next.count())) return false;

  const previousFingerprint = currentFingerprint.replace(/\s+/g, " ").trim();

  const clicked = await page.evaluate(() => {
    const win = window as typeof window & {
      jQuery?: ((selector: string) => {
        DataTable?: () => {
          page?: (direction: "next") => { draw: (mode: "page") => unknown };
        };
      });
    };

    const dataTable = win.jQuery?.("#mainGrid")?.DataTable?.();
    if (dataTable?.page) {
      dataTable.page("next").draw("page");
      return true;
    }

    const link = document.querySelector<HTMLAnchorElement>("#mainGrid_next:not(.disabled) a");
    if (!link) return false;
    link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
    return true;
  }).catch(async () => next
    .click({ timeout: 2_000, force: true })
    .then(() => true)
    .catch(() => false));

  if (!clicked) return false;

  const pageChanged = await page.waitForFunction(
    (previousFingerprint) => {
      const processing = document.querySelector<HTMLElement>("#mainGrid_processing");
      const fingerprint = document.querySelector("#mainGrid tbody")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return (!processing || processing.style.display === "none") && Boolean(fingerprint) && fingerprint !== previousFingerprint;
    },
    previousFingerprint,
    { timeout: facilityNavigationTimeoutMs() },
  ).then(() => true).catch(() => false);

  const nextDisabled = await page.evaluate(() => Boolean(document.querySelector("#mainGrid_next.disabled, #mainGrid_next.paginate_button.disabled"))).catch(() => false);
  return pageChanged && !nextDisabled;
}

async function scanFacilityList(
  page: Page,
  maxPages = 500,
  onProgress?: (progress: PortalScanProgress) => void,
  onRecords?: (records: PortalFacilityRecord[]) => void,
  options: { fresh?: boolean; mode?: PortalScanMode } = {},
) {
  const mode = options.mode ?? "quick";
  await openFacilitiesGrid(page);

  await page.waitForLoadState("domcontentloaded", { timeout: 8_000 }).catch(() => undefined);
  const gridReadiness = await getFacilitiesGridReadiness(page, 8_000);

  if (!gridReadiness.gridAttached && gridReadiness.rowCount <= 0) {
    throw new Error("The HEFAMAA facilities table is not ready on " + gridReadiness.pageTitle + " (" + gridReadiness.currentUrl + "). Open the portal, log in if required, then run Full Detail Scan again.");
  }

  await prepareFacilityGridForFullScan(page);
  await waitForFacilityTableRows(page, facilityNavigationTimeoutMs());

  const previousProgress = options.fresh ? null : readPortalListScanProgress();
  if (options.fresh) {
    clearPortalListScanProgress();
  }

  const portalReportedRecords = await readPortalReportedRecordCount(page);
  const records = options.fresh ? [] : classifyPortalFacilityRecords(readPortalFacilityCache());
  const seenPages = new Set<string>();
  const startPageNumber = previousProgress && !previousProgress.completed ? Math.max(1, previousProgress.pageNumber) : 1;
  const startRowNumber = previousProgress && !previousProgress.completed ? Math.max(1, previousProgress.rowNumber) : 1;

  if (startPageNumber > 1) {
    await goToFacilityTablePage(page, startPageNumber);
  }

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    throwIfPortalScanStopped();
    if (isGracefulStopRequested()) {
      const currentPage = await currentFacilityTablePageNumber(page);
      writePortalListScanProgress({
        completed: false,
        mode,
        pageNumber: currentPage,
        rowNumber: portalRuntime.scanProgress.currentPortalRow ?? 1,
        savedAt: new Date().toISOString(),
      });
      updatePortalScanProgress({
        completedAt: new Date().toISOString(),
        message: "SCAN_STOPPED_BY_USER",
        status: "cancelled",
        stopRequested: true,
      });
      break;
    }

    const rowCount = await waitForFacilityTableRows(page, facilityNavigationTimeoutMs());
    const currentRows = await getFacilityResultRows(page);
    const currentPageNumber = await currentFacilityTablePageNumber(page);
    const domFingerprint = await facilityTableFingerprint(page);
    const pageFingerprint = currentRows.map((row) => [row.hefamaaId, row.facilityName, row.registrationStatus].join("|")).join("::");

    if (pageFingerprint && seenPages.has(pageFingerprint)) {
      break;
    }

    if (pageFingerprint) {
      seenPages.add(pageFingerprint);
    }

    const shouldResumeInsideThisPage = previousProgress && !previousProgress.completed && currentPageNumber === startPageNumber;
    const rowStartIndex = shouldResumeInsideThisPage ? Math.max(0, startRowNumber - 1) : 0;

    for (let rowIndex = rowStartIndex; rowIndex < currentRows.length; rowIndex += 1) {
      throwIfPortalScanStopped();
      if (isGracefulStopRequested()) {
        writePortalListScanProgress({
          completed: false,
          mode,
          pageNumber: currentPageNumber,
          rowNumber: rowIndex + 1,
          savedAt: new Date().toISOString(),
        });
        updatePortalScanProgress({
          completedAt: new Date().toISOString(),
          currentPortalPage: currentPageNumber,
          currentPortalRow: rowIndex + 1,
          message: "SCAN_STOPPED_BY_USER",
          status: "cancelled",
          stopRequested: true,
        });
        return { portalReportedRecords, records: classifyPortalFacilityRecords(dedupeFacilityRecords(records)) };
      }

      const row = currentRows[rowIndex];
      const normalizedStatus = normalizePortalStatus(row.registrationStatus, row.renewalYear);
      const record: PortalFacilityRecord = {
        ...row,
        applicationType: inferPortalApplicationType(row, normalizedStatus),
        lastSeen: new Date().toISOString(),
        normalizedStatus,
        portalPageNumber: currentPageNumber,
        portalRowNumber: rowIndex + 1,
      };

      upsertPortalFacilityRecord(records, record);
      const classifiedRecords = classifyPortalFacilityRecords(dedupeFacilityRecords(records));
      writePortalFacilityCache(stampPortalScanRecords(classifiedRecords));
      writePortalListScanProgress({
        completed: false,
        mode,
        pageNumber: currentPageNumber,
        rowNumber: rowIndex + 2,
        savedAt: new Date().toISOString(),
      });

      appendPortalScanEvent({
        category: record.category,
        facilityName: record.facilityName,
        hefamaaId: record.hefamaaId,
        message: "Saved portal page " + currentPageNumber + ", row " + (rowIndex + 1) + ": " + portalRecordDisplayName(record),
        status: "info",
      });
      onProgress?.({
        completedAt: null,
        currentPortalPage: currentPageNumber,
        currentPortalRow: rowIndex + 1,
        lastProcessedPortalPage: currentPageNumber,
        lastProcessedPortalRow: rowIndex + 1,
        message: "Indexing portal page " + currentPageNumber + ", row " + (rowIndex + 1) + " of " + Math.max(rowCount, currentRows.length) + "...",
        phase: "indexing_list",
        portalReportedRecords,
        scannedPages: Math.max(currentPageNumber, pageIndex + 1),
        scannedRecords: classifiedRecords.length,
        startedAt: portalRuntime.scanProgress.startedAt,
        status: "running",
      });
      onRecords?.(classifiedRecords);
    }

    writePortalListScanProgress({
      completed: false,
      mode,
      pageNumber: currentPageNumber + 1,
      rowNumber: 1,
      savedAt: new Date().toISOString(),
    });

    const hasNext = await clickNextFacilityPage(page, domFingerprint);
    if (!hasNext) break;
  }

  const finalRecords = classifyPortalFacilityRecords(dedupeFacilityRecords(records));
  writePortalFacilityCache(stampPortalScanRecords(finalRecords));
  writePortalListScanProgress({
    completed: true,
    mode,
    pageNumber: await currentFacilityTablePageNumber(page),
    rowNumber: 1,
    savedAt: new Date().toISOString(),
  });
  onRecords?.(finalRecords);
  return { portalReportedRecords, records: finalRecords };
}

function stampPortalScanRecords(records: PortalFacilityRecord[], lastSeen = new Date().toISOString()) {
  return records.map((record) => ({
    ...record,
    lastSeen,
  }));
}

function notificationAutoSendEnabledAfterScan(mode: PortalScanMode) {
  if (process.env.NOTIFICATION_AUTO_SEND_AFTER_SCAN !== "true") return false;
  if (mode === "quick" && process.env.NOTIFICATION_AUTO_SEND_AFTER_QUICK_SCAN !== "true") return false;
  return true;
}

async function triggerNotificationAutoSendAfterScan(mode: PortalScanMode) {
  if (!notificationAutoSendEnabledAfterScan(mode)) return;

  appendPortalScanEvent({
    message: "Facility notification auto-response started from the completed portal scan.",
    status: "info",
  });

  try {
    const { MAX_NOTIFICATION_RECIPIENTS, runDailyNotificationScan } = await import("@/lib/notificationEngine");
    const result = await runDailyNotificationScan({
      channels: ["email", "sms"],
      confirmed: true,
      createdBy: "HEFA-AI Portal Scan",
      limit: MAX_NOTIFICATION_RECIPIENTS,
    });
    const logs = Array.isArray(result.logs) ? result.logs : [];
    const sent = logs.filter((log) => log.status === "sent").length;
    const skipped = logs.filter((log) => log.status === "skipped").length;
    const failed = logs.filter((log) => log.status === "failed").length;
    appendPortalScanEvent({
      message: "Facility notification auto-response completed. Sent " + sent + ", skipped " + skipped + ", failed " + failed + ".",
      status: failed > 0 ? "failed" : "info",
    });
  } catch (error) {
    appendPortalScanEvent({
      error: error instanceof Error ? error.message : "Unknown notification automation error",
      message: "Facility notification auto-response could not complete after portal scan.",
      status: "failed",
    });
  }
}

export async function scanAllPortalFacilities(mode: PortalScanMode = "quick", options: { onlyMissingBeds?: boolean; preflightDone?: boolean } = {}) {
  throwIfPortalScanStopped();
  const isDetailScan = mode === "full" || mode === "fresh_full_scan";
  const preflight = isDetailScan && !options.preflightDone ? await runFullScanPreflight(mode, { ensureFacilityList: true, timeoutMs: 15_000 }) : null;
  if (preflight && !preflight.readyForFullScan) {
    throw new Error("Full Scan could not start because: " + (preflight.reason ?? "Portal session is not ready"));
  }
  const session = await requireActivePortalSessionForScan(mode);
  const primaryPage = session.page && !session.page.isClosed() ? session.page : null;

  if (!primaryPage) {
    throw new Error("Please click Open Portal and login first before running " + (isDetailScan ? "Full Scan" : "Quick Scan") + ".");
  }

  const scanPage = primaryPage;
  scanPage.setDefaultTimeout(isDetailScan ? facilityCaptureTimeoutMs() : 10_000);
  scanPage.setDefaultNavigationTimeout(isDetailScan ? facilityNavigationTimeoutMs() : 30_000);
  let partialRecords: PortalFacilityRecord[] = [];

  try {
    throwIfPortalScanStopped();
    const cachedRecords = classifyPortalFacilityRecords(readPortalFacilityCache());
    const shouldReuseListCache = isDetailScan && mode !== "fresh_full_scan" && cachedRecords.length > 0;
    let portalReportedRecords: number | null = null;
    let records: PortalFacilityRecord[] = [];

    if (shouldReuseListCache) {
      records = cachedRecords;
      portalReportedRecords = portalRuntime.scanProgress.portalReportedRecords ?? records.length;
      updatePortalScanProgress({
        detailTotal: latestDetailTargetRecords(records).length,
        message: "Using the existing portal index. Full detail capture will open only the latest valid renewal record for each facility identity.",
        phase: "capturing_details",
        portalReportedRecords,
        scanMode: mode,
        scannedRecords: records.length,
      });
    } else {
      const scanned = await scanFacilityList(
        scanPage,
        500,
        (progress) => {
          updatePortalScanProgress({
            ...progress,
            detailTotal: isDetailScan ? portalRuntime.scanProgress.detailTotal ?? 0 : 0,
            scanMode: mode,
            scannedDetails: isDetailScan ? portalRuntime.scanProgress.scannedDetails ?? 0 : 0,
          });
        },
        (recordsSoFar) => {
          partialRecords = recordsSoFar;
        },
        { fresh: mode === "fresh_full_scan", mode },
      );
      portalReportedRecords = scanned.portalReportedRecords;
      records = scanned.records;
    }

    const now = new Date().toISOString();
    const datedRecords = shouldReuseListCache ? records : stampPortalScanRecords(records, now);

    if (!shouldReuseListCache) {
      writePortalFacilityCache(datedRecords);
    }

    throwIfPortalScanStopped();
    const detailTargetRecords = mode === "fresh_full_scan"
      ? [...datedRecords].sort((a, b) => {
          const pageOrder = (a.portalPageNumber ?? Number.MAX_SAFE_INTEGER) - (b.portalPageNumber ?? Number.MAX_SAFE_INTEGER);
          if (pageOrder) return pageOrder;
          const rowOrder = (a.portalRowNumber ?? Number.MAX_SAFE_INTEGER) - (b.portalRowNumber ?? Number.MAX_SAFE_INTEGER);
          if (rowOrder) return rowOrder;
          return facilityRecordKey(a).localeCompare(facilityRecordKey(b));
        })
      : latestDetailTargetRecords(datedRecords);
    const detailRecords = isDetailScan
      ? await capturePortalFacilityDetails(scanPage, detailTargetRecords, {
          fresh: mode === "fresh_full_scan",
          onlyMissingBeds: Boolean(options.onlyMissingBeds),
          scanMode: mode,
        })
      : readPortalFacilityDetailsCache();
    const detailLastCaptured = lastDetailCapturedAt(detailRecords);
    const currentDetailMap = portalDetailCacheMap(detailRecords);
    const capturedCurrentDetails = detailTargetRecords.filter((record) => currentDetailMap.has(portalDetailCacheKey(record))).length;
    const enrichedRecords = mergePortalFacilityDetails(datedRecords);
    const latestFacilities = latestUniqueFacilityRecords(enrichedRecords);
    const facilityTypeCounts = countByFacilityType(enrichedRecords);
    const statusCounts = summarizeStatus(latestFacilities);

    updatePortalScanProgress({
      completedAt: now,
      currentFacilityHefamaaId: null,
      currentFacilityName: null,
      detailTotal: isDetailScan ? (portalRuntime.scanProgress.detailTotal ?? detailTargetRecords.length) : portalRuntime.scanProgress.detailTotal ?? 0,
      lastCapturedFacilityName: isDetailScan ? portalRuntime.scanProgress.lastCapturedFacilityName ?? null : null,
      message: isGracefulStopRequested()
        ? "SCAN_STOPPED_BY_USER"
        : isDetailScan
          ? (mode === "fresh_full_scan"
            ? "Fresh Full Scan completed. Recaptured " + (portalRuntime.scanProgress.recapturedDetails ?? 0) + " records and updated the portal cache without duplicates."
            : "Full detail scan completed. Captured " + capturedCurrentDetails + " of " + detailTargetRecords.length + " latest valid facility detail records.")
          : "Quick portal scan completed. Indexed " + datedRecords.length + " portal rows.",
      phase: "completed",
      portalReportedRecords,
      scanMode: mode,
      scannedDetails: isDetailScan ? (mode === "fresh_full_scan" ? portalRuntime.scanProgress.scannedDetails ?? 0 : capturedCurrentDetails) : portalRuntime.scanProgress.scannedDetails ?? 0,
      scannedPages: portalRuntime.scanProgress.scannedPages,
      scannedRecords: datedRecords.length,
      startedAt: portalRuntime.scanProgress.startedAt,
      status: isGracefulStopRequested() ? "cancelled" : "completed",
      stopRequested: isGracefulStopRequested(),
    });

    const result = {
      totalFacilities: latestFacilities.length,
      totalPortalRecords: enrichedRecords.length,
      portalReportedRecords,
      categoryCounts: countByCategory(latestFacilities),
      categoryPortalRecordCounts: countByCategory(enrichedRecords),
      detailLastCaptured,
      detailRecords: detailRecords.length,
      applicationTypeCounts: countByApplicationType(enrichedRecords),
      facilityTypeCounts,
      statusCounts,
      scanProgress: portalRuntime.scanProgress,
      lastScanned: now,
      monthlyRegistrationCounts: countByMonth(enrichedRecords),
      monthlyNewRegistrationCounts: countByMonth(enrichedRecords, "new_registration"),
      monthlyRenewalCounts: countByMonth(enrichedRecords, "renewal"),
      yearlyPortalRecordCounts: countByYear(enrichedRecords),
      yearlyRenewalCounts: countByYear(enrichedRecords, "renewal"),
      note: datedRecords.length === 0 ? "No facility rows were found during portal scan." : undefined,
    };
    writePortalScanSnapshot({
      categoryCounts: countByCategory(latestFacilities),
      distinctFacilities: latestFacilities.length,
      existingFacilities: facilityTypeCounts.existing_facility,
      indexedRows: datedRecords.length,
      newFacilities: facilityTypeCounts.new_registration,
      portalReportedRecords,
      records: datedRecords,
      scannedPages: portalRuntime.scanProgress.scannedPages,
      scannedRecords: datedRecords.length,
      statusCounts,
      unknownFacilities: facilityTypeCounts.unknown,
    });
    void triggerNotificationAutoSendAfterScan(mode);
    return result;
  } catch (error) {
    if (partialRecords.length) {
      writePortalFacilityCache(stampPortalScanRecords(partialRecords));
    }
    throw error;
  } finally {
    if (!scanPage.isClosed()) {
      session.page = scanPage;
      setSession(session);
      await updateOpenTabsCount(scanPage.context()).catch(() => 0);
    }
  }
}

export async function startPortalFacilityScan(input: { mode?: PortalScanMode; onlyMissingBeds?: boolean } = {}) {
  const mode = input.mode ?? "quick";
  if (portalRuntime.scanPromise) {
    if (portalRuntime.scanProgress.status === "running" && !portalRuntime.scanStopRequested && !portalRuntime.scanController.stopRequested) {
      return getFastPortalFacilitySummary();
    }

    portalRuntime.scanPromise = null;
    portalRuntime.openingSession = null;
  }

  if (mode === "full" || mode === "fresh_full_scan") {
    console.info("[portal/scan] Full Scan clicked", { mode });
    const preflight = await runFullScanPreflight(mode, { ensureFacilityList: true, timeoutMs: 15_000 });
    if (!preflight.readyForFullScan) {
      throw new Error("Full Scan could not start because: " + (preflight.reason ?? "Portal session is not ready"));
    }
    console.info("[portal/scan] Full Scan started", preflight);
  } else {
    await requireActivePortalSessionForScan(mode);
  }

  portalRuntime.scanStopRequested = false;
  clearPortalScanStopSignal();
  const startedAt = new Date().toISOString();
  const scanId = createScanId(mode);
  updateScanController({
    scanId,
    scanRunning: true,
    stopRequested: false,
    scanMode: mode,
    currentFacility: null,
    capturedCount: 0,
    failedCount: 0,
    skippedCount: 0,
    startedAt,
    stoppedAt: null,
  });
  updatePortalScanProgress({
    completedAt: null,
    scanId,
    stopRequested: false,
    openTabsCount: getSession()?.context ? usablePages(getSession()!.context).length : 0,
    currentFacilityHefamaaId: null,
    currentFacilityName: null,
    detailTotal: 0,
    error: undefined,
    failedDetails: 0,
    keepAwakeActive: false,
    lastCapturedFacilityName: null,
    message: mode === "fresh_full_scan" ? "Starting Fresh Full Scan from the beginning..." : mode === "full" ? "Starting full detail scan for latest valid facility records..." : "Starting quick portal scan...",
    phase: "starting",
    portalReportedRecords: null,
    recentEvents: [createPortalScanEvent({
      message: mode === "fresh_full_scan" ? "Fresh Full Scan started." : mode === "full" ? "Full detail scan started." : "Quick portal scan started.",
      status: "info",
    })],
    scanCompletionReport: undefined,
    scanMode: mode,
    scannedDetails: 0,
    recapturedDetails: 0,
    bedsCapturedCount: 0,
    missingBedDataCount: 0,
    onlyMissingBeds: Boolean(input.onlyMissingBeds),
    scannedPages: 0,
    scannedRecords: 0,
    skippedDetails: 0,
    startedAt,
    status: "running",
  });

  startPortalScanKeepAwake(mode);

  // The promise is kept in module state so a full detail scan can continue while the user navigates the app.
  const scanPromise = scanAllPortalFacilities(mode, { onlyMissingBeds: input.onlyMissingBeds, preflightDone: mode === "full" || mode === "fresh_full_scan" })
    .then(() => undefined)
    .catch((error) => {
      const errorMessage = scanErrorMessage(error);
      const cancelled = isPortalScanCancellationError(error);
      appendPortalScanEvent({
        error: cancelled ? undefined : errorMessage,
        message: cancelled ? "Portal scan stopped by user. Already captured records remain saved in the local cache." : "Portal scan stopped: " + errorMessage,
        status: cancelled ? "info" : "failed",
      });
      updatePortalScanProgress({
        completedAt: new Date().toISOString(),
        currentFacilityHefamaaId: null,
        currentFacilityName: null,
        error: cancelled ? undefined : errorMessage,
        message: cancelled ? "Portal scan stopped by user. You can restart Full Detail Scan and it will resume from cached captures." : "Portal scan stopped: " + errorMessage,
        status: cancelled ? "cancelled" : "failed",
      });
      if (!cancelled) console.error("[portal/scan] full scan failed", error);
    })
    .finally(() => {
      void stopPortalScanKeepAwake();
      if (portalRuntime.scanPromise === scanPromise) portalRuntime.scanPromise = null;
      updateScanController({ scanRunning: false, currentFacility: null, stoppedAt: isGracefulStopRequested() ? new Date().toISOString() : portalRuntime.scanController.stoppedAt });
      syncScanControllerProgress();
    });
  portalRuntime.scanPromise = scanPromise;

  return getFastPortalFacilitySummary();
}

export async function stopPortalFacilityScan() {
  if (!portalRuntime.scanPromise && portalRuntime.scanProgress.status !== "running") {
    return {
      ...getFastPortalFacilitySummary(),
      code: "NO_SCAN_RUNNING",
      message: "No portal scan is currently running.",
    };
  }

  writePortalScanStopSignal();
  updateScanController({
    stopRequested: true,
    stoppedAt: new Date().toISOString(),
  });
  appendPortalScanEvent({
    message: "Stop requested. Scan will stop after the current facility.",
    status: "info",
  });
  updatePortalScanProgress({
    message: "Stop requested. Scan will stop after the current facility finishes.",
    status: "running",
    stopRequested: true,
  });

  const session = getSession();
  if (session?.context && session.page && !session.page.isClosed()) {
    await closeExtraBlankTabs(session.context, session.page).catch(() => undefined);
  }

  return {
    ...getFastPortalFacilitySummary(),
    code: "STOP_REQUESTED",
    message: "Stop requested. Scan will stop after current facility.",
  };
}


export function getPortalFacilityExportRecords() {
  const listPath = portalFacilityCachePath();
  const detailsPath = portalFacilityDetailsCachePath();
  const listMtimeMs = fileMtimeMs(listPath);
  const detailsMtimeMs = fileMtimeMs(detailsPath);

  if (portalFacilityExportCache?.path === listPath && portalFacilityExportCache.mtimeMs === listMtimeMs && portalFacilityExportCache.detailsPath === detailsPath && portalFacilityExportCache.detailsMtimeMs === detailsMtimeMs) {
    return portalFacilityExportCache.value;
  }

  const records = mergePortalFacilityDetails(readPortalFacilityCache());
  portalFacilityExportCache = { path: listPath, mtimeMs: listMtimeMs, detailsPath, detailsMtimeMs, value: records };
  return records;
}

export function searchPortalFacilityCache(input: {
  category?: string;
  limit?: number;
  query?: string;
  status?: string;
  year?: number;
} = {}) {
  const records = getPortalFacilityExportRecords();
  const query = cleanPortalText(input.query).toLowerCase();
  const category = cleanPortalText(input.category).toLowerCase();
  const status = cleanPortalText(input.status).toLowerCase();
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 250);
  const matches = records.filter((record) => {
    const searchable = [
      record.facilityName,
      record.hefamaaId,
      record.category,
      record.registrationStatus,
      record.text,
      ...Object.entries(record.visibleFields ?? {}).flatMap(([header, value]) => [header, value]),
    ].join(" ").toLowerCase();

    if (query && !searchable.includes(query)) return false;
    if (category && cleanPortalText(record.category).toLowerCase() !== category) return false;
    if (status && record.normalizedStatus !== status && cleanPortalText(record.registrationStatus).toLowerCase() !== status) return false;
    if (input.year && record.renewalYear !== input.year) return false;
    return true;
  });

  return {
    cachedFacilities: records.length,
    matchCount: matches.length,
    records: matches.slice(0, limit),
  };
}

export function getPortalFacilitySummary() {
  const listPath = portalFacilityCachePath();
  const detailsPath = portalFacilityDetailsCachePath();
  const listMtimeMs = fileMtimeMs(listPath);
  const detailsMtimeMs = fileMtimeMs(detailsPath);

  if (portalFacilitySummaryCache?.path === listPath
    && portalFacilitySummaryCache.mtimeMs === listMtimeMs
    && portalFacilitySummaryCache.detailsPath === detailsPath
    && portalFacilitySummaryCache.detailsMtimeMs === detailsMtimeMs) {
    return getFastPortalFacilitySummary();
  }

  if (portalRuntime.scanProgress.status === "running" && portalFacilitySummaryCache?.value) {
    return getFastPortalFacilitySummary();
  }

  // Cache files changed or no summary exists yet, so rebuild the data snapshot.
  const detailRecords = readPortalFacilityDetailsCache();
  const records = classifyPortalFacilityRecords(getPortalFacilityExportRecords());
  const latestFacilities = latestUniqueFacilityRecords(records);
  const lastScanned = records[0]?.lastSeen ?? null;
  const summary = {
    totalFacilities: latestFacilities.length,
    totalPortalRecords: records.length,
    portalReportedRecords: portalRuntime.scanProgress.portalReportedRecords ?? (records.length || null),
    categoryCounts: countByCategory(latestFacilities),
    categoryPortalRecordCounts: countByCategory(records),
    detailLastCaptured: lastDetailCapturedAt(detailRecords),
    detailRecords: detailRecords.length,
    applicationTypeCounts: countByApplicationType(records),
    facilityTypeCounts: countByFacilityType(records),
    statusCounts: summarizeStatus(latestFacilities),
    scanProgress: portalRuntime.scanProgress,
    lastScanned,
    monthlyRegistrationCounts: countByMonth(records),
    monthlyNewRegistrationCounts: countByMonth(records, "new_registration"),
    monthlyRenewalCounts: countByMonth(records, "renewal"),
    yearlyPortalRecordCounts: countByYear(records),
    yearlyRenewalCounts: countByYear(records, "renewal"),
    note: records.length === 0 ? "No cached portal facilities found. Run portal scan first." : undefined,
  } satisfies PortalFacilitySummary;

  portalFacilitySummaryCache = { path: listPath, mtimeMs: listMtimeMs, detailsPath, detailsMtimeMs, value: summary };
  return summary;
}

function normalizeSelectionName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function rowSelectionScore(row: FacilitySearchResultRow, query: string, targetYear: number | null) {
  const rowName = normalizeSelectionName(row.facilityName || row.text);
  const queryName = normalizeSelectionName(query);
  let score = 0;

  if (targetYear && row.renewalYear === targetYear) score += 40;
  if (/approved|current|registered/i.test(row.registrationStatus)) score += 25;
  if (queryName && rowName === queryName) score += 45;
  else if (queryName && rowName.includes(queryName)) score += 30;
  else if (queryName && queryName.includes(rowName) && rowName.length > 4) score += 20;
  if (row.hefamaaId) score += 5;
  if (row.hasAction) score += 5;

  return score;
}

function selectRenewalRecord(rows: FacilitySearchResultRow[], query = "") {
  const currentRenewalYear = getCurrentRenewalYear();
  const latestAvailableRenewalYear = rows.reduce<number | null>((latest, row) => {
    if (!row.renewalYear) return latest;
    return latest === null || row.renewalYear > latest ? row.renewalYear : latest;
  }, null);
  const currentYearRows = rows.filter((row) => row.renewalYear === currentRenewalYear);
  const latestYearRows = latestAvailableRenewalYear
    ? rows.filter((row) => row.renewalYear === latestAvailableRenewalYear)
    : [];
  const selectedRows = currentYearRows.length ? currentYearRows : latestYearRows.length ? latestYearRows : rows;
  const targetYear = currentYearRows.length ? currentRenewalYear : latestAvailableRenewalYear;
  const rankedRows = selectedRows
    .map((row) => ({ row, score: rowSelectionScore(row, query, targetYear) }))
    .sort((a, b) => b.score - a.score);
  const top = rankedRows[0] ?? null;
  const next = rankedRows[1] ?? null;
  const selectedRecord =
    rankedRows.length === 1 || (top && (!next || top.score - next.score >= 15)) ? top?.row ?? null : null;

  if (!selectedRecord) {
    return {
      currentRenewalYear,
      latestAvailableRenewalYear,
      selectedRecord: null,
      selectedRenewalYear: null,
      renewalStatus: "unknown_year" as const,
      ambiguous: true,
    };
  }

  const selectedRenewalYear = selectedRecord.renewalYear ?? null;
  const renewalStatus: PortalRenewalSelection["renewalStatus"] =
    selectedRenewalYear === currentRenewalYear
      ? "current_year"
      : selectedRenewalYear
        ? "latest_available_previous_year"
        : "unknown_year";

  return {
    currentRenewalYear,
    latestAvailableRenewalYear,
    selectedRecord,
    selectedRenewalYear,
    renewalStatus,
    ambiguous: false,
  };
}

async function openFacilityResult(page: Page, rowIndex: number) {
  return page.evaluate(async (targetRowIndex) => {
    const row = Array.from(document.querySelectorAll("table tbody tr"))[targetRowIndex];
    const action = row?.querySelector<HTMLElement>('a[onclick*="editRow"], a[href="javascript:void(0)"], button, [role="button"]');

    if (!action) {
      return false;
    }

    const link = action.closest("a") as HTMLAnchorElement | null;
    if (link) link.removeAttribute("target");
    action.click();
    return true;
  }, rowIndex);
}

async function waitForFacilityRecordReady(page: Page, facilityName = "", timeoutMs = 2_500) {
  const targetName = cleanPortalText(facilityName).toLowerCase();

  await Promise.race([
    page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => undefined),
    page.waitForFunction(
      ({ targetName }) => {
        const body = document.body?.innerText ?? "";
        const lowerBody = body.toLowerCase();
        const targetVisible = !targetName || lowerBody.includes(targetName);
        const hasDetailKeyword = /admin activ|registration approval|professional staff|facility information|owner|director|license|licence|approval/i.test(body);
        const visibleDialog = Array.from(document.querySelectorAll<HTMLElement>(".modal,.modal-dialog,[role='dialog']")).some((element) => {
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        });

        return targetVisible && (hasDetailKeyword || visibleDialog);
      },
      { targetName },
      { timeout: timeoutMs },
    ).catch(() => undefined),
  ]).catch(() => undefined);

  await page.waitForFunction(() => Boolean((document.body?.innerText || "").trim()), null, { timeout: 300 }).catch(() => undefined);
}

function getApprovalEvidence(pageText: string, selectedRenewalYear: number | null) {
  const lines = pageText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const evidence: string[] = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    // Priority: User defined keywords "Admin Activities" and "Registration Approval"
    const isRegistrationApproval = lower.includes("registration approval");
    const isAdminActivity = lower.includes("admin activ");
    const isApprovalStatus = lower.includes("approved") || lower.includes("status: current");
    const hasDate = /\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(line);

    if (isRegistrationApproval || isAdminActivity || isApprovalStatus || hasDate) {
      evidence.push(line);
    }
  }

  // Sort to bring lines with dates and "Approved" status to the top for the Mapper
  return evidence
    .sort((a, b) => {
      const score = (text: string) => {
        let s = 0;
        const t = text.toLowerCase();
        if (t.includes("registration approval")) s += 20;
        if (t.includes("approved")) s += 15;
        if (/\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}/.test(text)) s += 10;
        if (selectedRenewalYear && text.includes(String(selectedRenewalYear))) s += 5;
        return s;
      };
      return score(b) - score(a);
    })
    .slice(0, 20);
}

function buildRenewalSelectionFromRecord(input: {
  rows: FacilitySearchResultRow[];
  selectedRecord: FacilitySearchResultRow;
  openedText: string;
}): PortalRenewalSelection {
  const currentRenewalYear = getCurrentRenewalYear();
  const latestAvailableRenewalYear = input.rows.reduce<number | null>((latest, row) => {
    if (!row.renewalYear) return latest;
    return latest === null || row.renewalYear > latest ? row.renewalYear : latest;
  }, null);
  const selectedRenewalYear = input.selectedRecord.renewalYear ?? null;
  const renewalStatus: PortalRenewalSelection["renewalStatus"] =
    selectedRenewalYear === currentRenewalYear
      ? "current_year"
      : selectedRenewalYear
        ? "latest_available_previous_year"
        : "unknown_year";

  return {
    currentRenewalYear,
    latestAvailableRenewalYear,
    selectedRenewalYear,
    renewalStatus,
    selectedRecord: input.selectedRecord,
    matches: input.rows,
    approvalEvidence: getApprovalEvidence(input.openedText, selectedRenewalYear),
  };
}

export async function openPortal() {
  if (process.env.RENDER && !getSession()) {
    return {
      status: "closed",
      url: getPortalUrl(),
      requiresManualLogin: true,
      persistentProfile: true,
      browserChannel: browserChannelLabel(getPortalBrowserChannel()),
      profileName: profileName(getPortalProfileDir()),
      note: "Hosted Render cannot open or control your local browser tab. Run portal scanning locally, or configure a controlled portal browser bridge/headless login workflow.",
    };
  }

  const currentSession = getSession();

  if (currentSession && !currentSession.page.isClosed()) {
    void currentSession.page.bringToFront().catch(() => undefined);
    currentSession.lastActivity = new Date().toISOString();
    setSession(currentSession);
    return {
      status: "opened",
      url: currentSession.page.url(),
      requiresManualLogin: true,
      persistentProfile: true,
      browserChannel: browserChannelLabel(currentSession.browserChannel ?? getPortalBrowserChannel()),
      profileName: profileName(currentSession.profileDir),
      note: "Portal browser session is already active and has been brought to the front.",
    };
  }

  if (!portalRuntime.openingSession) {
    const openingSession = ensureSession({ fastOpen: true });
    portalRuntime.openingSession = openingSession;
    void openingSession
      .catch((error) => {
        console.error("[portal/open] background browser startup failed", error);
      })
      .finally(() => {
        if (portalRuntime.openingSession === openingSession) portalRuntime.openingSession = null;
      });
  }

  return {
    status: "opening",
    url: getPortalUrl(),
    requiresManualLogin: true,
    persistentProfile: true,
    browserChannel: browserChannelLabel(getPortalBrowserChannel()),
    profileName: profileName(getPortalProfileDir()),
    note: "Portal browser launch requested. The controlled portal window should open shortly; log in manually, then navigate to the facility list.",
  };
}

export async function getPortalSessionStatus() {
  let currentSession = getSession();
  const debuggingReady = await portalDebuggingEndpointReady(getPortalDebuggingPort());

  if ((!currentSession || currentSession.page.isClosed()) && debuggingReady) {
    currentSession = await ensureSession({ fastOpen: true }).catch(() => null);
  }

  const opening = Boolean(portalRuntime.openingSession);
  const active = Boolean(currentSession && !currentSession.page.isClosed());
  const reusableDedicatedBrowser = !active && debuggingReady;
  const profileDir = currentSession?.profileDir ?? getPortalProfileDir();
  const lock = getPortalProfileLock(profileDir);

  return {
    status: active ? "active" : opening || reusableDedicatedBrowser ? "opening" : "closed",
    url: active ? currentSession?.page.url() : null,
    browserChannel: browserChannelLabel(currentSession?.browserChannel ?? getPortalBrowserChannel()),
    persistentProfile: true,
    profileName: profileName(profileDir),
    storageStateSaved: portalStorageStateExists(),
    lastLoginSavedAt: portalStorageStateMtime(),
    startupMetrics: portalRuntime.startupMetrics,
    profileLocked: !active && !opening && !debuggingReady && lock.locked,
    profileLockPid: !active && !opening && !debuggingReady ? lock.pid : undefined,
    note: active
      ? "Portal browser session is active. Search, capture, quick scan, and full scan will reuse this controlled portal session."
      : reusableDedicatedBrowser
        ? "Controlled portal browser is running and reachable. The agent will reconnect to it automatically."
        : opening
          ? "Controlled portal browser is starting in the background. It will reuse the saved portal session and become available for search and capture shortly."
          : lock.locked
            ? `Portal browser session is locked${lock.pid ? ` by process ${lock.pid}` : ""}. If this is the old controlled portal session, close it or use Release Lock before opening again.`
            : "Portal browser is closed. Opening it will reuse the saved portal session if the portal has not expired it.",
  };
}

async function detectFacilityListPage(page: Page) {
  try {
    const readiness = await getFacilitiesGridReadiness(page, 1_500);
    if (readiness.gridVisible || readiness.rowCount > 0) return true;

    return await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").toLowerCase();
      const tableLike = document.querySelectorAll("table tbody tr, [role='row'], .ag-row, .dx-row, tr, table").length;
      const inputLike = document.querySelectorAll("input, select, button").length;
      const hasFacilityWords = /facility|facilities|hefamaa|hef\/?no|registration status|category|manage facilities|facility name/.test(text);
      const hasListWords = /search|filter|records|showing|entries|renewal|new registration|approved|pending|queried/.test(text);
      return Boolean(hasFacilityWords && (hasListWords || tableLike >= 1 || inputLike >= 3));
    });
  } catch {
    return false;
  }
}


async function detectLoggedInPage(page: Page) {
  try {
    const url = page.url().toLowerCase();
    if (/\/login|signin|sign-in/.test(url)) return false;
    return await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").toLowerCase();
      const passwordInput = document.querySelector("input[type='password']");
      if (passwordInput && /login|sign in|password/.test(text)) return false;
      if (/login to your account|forgot password/.test(text)) return false;
      return /dashboard|logout|sign out|facility|facilities|application|renewal|profile|manage/.test(text) || text.length > 200;
    });
  } catch {
    return false;
  }
}

export async function getPortalSessionManagerStatus() {
  let session = getSession();
  if ((!session || session.page.isClosed()) && (await portalDebuggingEndpointReady(getPortalDebuggingPort()))) {
    session = await reconnectExistingDedicatedPortalSession();
  }

  const browserOpen = Boolean(session && !session.page.isClosed());
  const currentPage = browserOpen ? session?.page.url() ?? null : null;
  const loginStartedAt = Date.now();
  const loggedIn = browserOpen && session ? await detectLoggedInPage(session.page) : false;
  if (browserOpen) updateStartupMetric("loginDetectionMs", loginStartedAt);
  if (browserOpen && session && loggedIn) void persistPortalStorageState(session);
  const facilityListStartedAt = Date.now();
  const facilityListDetected = browserOpen && session ? await detectFacilityListPage(session.page) : false;
  if (browserOpen) updateStartupMetric("facilityListReadyMs", facilityListStartedAt);
  const browserConnected = browserOpen && session ? await isPortalSessionHealthy(session, 800) : false;
  const fullScanPreflight = browserOpen && session
    ? {
        browserOpen,
        browserConnected,
        sessionSaved: portalStorageStateExists(),
        loggedIn,
        currentUrl: currentPage,
        facilityListDetected,
        readyForFullScan: Boolean(browserOpen && browserConnected && loggedIn && facilityListDetected),
        reason: !browserConnected ? "Browser disconnected" : !loggedIn ? "Not logged in" : !facilityListDetected ? "Facility list not detected" : null,
      }
    : fullScanPreflightFailure({ reason: portalStorageStateExists() ? "Portal browser not open; saved session is available" : "Portal browser not open" });
  const cachedFacilities = classifyPortalFacilityRecords(readPortalFacilityCache()).length;
  const summary = getFastPortalFacilitySummary();

  return {
    browserOpen,
    loggedIn,
    facilityListDetected,
    currentPage,
    cachedFacilities,
    lastScan: summary.lastScanned ?? summary.scanProgress.completedAt ?? null,
    scanRunning: portalRuntime.scanProgress.status === "running" && Boolean(portalRuntime.scanPromise),
    openedAt: session?.openedAt ?? null,
    lastActivity: session?.lastActivity ?? null,
    currentFacility: portalRuntime.scanProgress.currentFacilityName ?? null,
    portalSessionState: loggedIn ? "active" : browserOpen ? "expired" : portalStorageStateExists() ? "saved" : "missing",
    storageStateSaved: portalStorageStateExists(),
    lastLoginSavedAt: portalStorageStateMtime(),
    startupMetrics: portalRuntime.startupMetrics,
    fullScanPreflight,
    readyForFullScan: fullScanPreflight.readyForFullScan,
    fullScanBlockedReason: fullScanPreflight.reason,
    scanProgress: portalRuntime.scanProgress,
  };
}

export const PortalSessionManager = {
  clearSession: clearPortalSession,
  close: closePortal,
  getSession,
  open: openPortal,
  reconnect: reconnectPortalSession,
  saveSession: savePortalSession,
  requireSessionForScan: requireActivePortalSessionForScan,
  status: getPortalSessionManagerStatus,
};

export async function searchFacility({ facilityName, openSelectedRecord = true }: SearchFacilityInput) {
  const session = await getActiveSession();
  const { page } = session;
  const query = facilityName.trim();

  if (!query) {
    throw new Error("Facility name is required");
  }

  session.renewalSelection = null;
  setSession(session);

  const input = await openFacilitiesSearchPage(page);

  if (!input) {
    return {
      status: "manual_search_required",
      url: page.url(),
      facilityName: query,
      note: "The agent could not reach the HEFAMAA Facilities search field. Open Manage Facilities > Facilities in the portal, then try Search Portal again.",
    };
  }

  await input.fill(query);
  await input.press("Enter");
  await clickSearchButtonIfAvailable(page);
  await waitForFacilitySearchResults(page, query);

  const rows = await getFacilityResultRows(page);
  const visibleTextPreview = (await getVisibleText(page)).slice(0, 800);

  if (rows.length === 0) {
    return {
      status: "no_match",
      url: page.url(),
      facilityName: query,
      matchCount: 0,
      note: "No matching portal record was found for this facility name.",
      visibleTextPreview,
    };
  }

  session.lastSearchRows = rows;
  session.lastSearchQuery = query;
  setSession(session);

  const selection = selectRenewalRecord(rows, query);

  if (selection.ambiguous || !selection.selectedRecord) {
    return {
      status: "ambiguous_renewal_matches",
      url: page.url(),
      facilityName: query,
      currentRenewalYear: selection.currentRenewalYear,
      latestAvailableRenewalYear: selection.latestAvailableRenewalYear,
      matchCount: rows.length,
      matches: rows,
      note: rows.length + " portal records matched. Choose the correct portal row below, then the agent will open and capture that renewal record.",
      visibleTextPreview,
    };
  }

  const shouldOpenSelectedRecord = openSelectedRecord;
  const clickedSelectedRecord = shouldOpenSelectedRecord
    ? await openFacilityResult(page, selection.selectedRecord.index).catch(() => false)
    : false;

  if (clickedSelectedRecord) {
    await waitForFacilityRecordReady(page, selection.selectedRecord.facilityName || query, 2_500);
  }

  const openedText = await getVisibleText(page);
  const renewalSelection = buildRenewalSelectionFromRecord({
    rows,
    selectedRecord: selection.selectedRecord,
    openedText,
  });
  const currentSession = getSession();

  if (currentSession) {
    currentSession.renewalSelection = renewalSelection;
    currentSession.page = page;
    await persistPortalStorageState(currentSession);
    setSession(currentSession);
  }

  const status =
    selection.renewalStatus === "current_year"
      ? "opened_current_renewal"
      : selection.renewalStatus === "latest_available_previous_year"
        ? "opened_latest_available_renewal"
        : "opened_facility";

  return {
    status,
    url: page.url(),
    facilityName: query,
    currentRenewalYear: selection.currentRenewalYear,
    latestAvailableRenewalYear: selection.latestAvailableRenewalYear,
    matchCount: rows.length,
    matches: rows,
    renewalStatus: selection.renewalStatus,
    selectedPortalRecord: selection.selectedRecord,
    selectedRenewalYear: selection.selectedRenewalYear,
    selectedRecordOpened: clickedSelectedRecord,
    note:
      selection.renewalStatus === "current_year"
        ? `Opened the ${selection.currentRenewalYear} current renewal portal record for ${query}.`
        : `Opened the latest available portal renewal record (${selection.selectedRenewalYear ?? "unknown year"}) for ${query}; no ${selection.currentRenewalYear} record was found.`,
    visibleTextPreview: openedText.slice(0, 800),
  };
}

export async function openSearchResultRecord({ rowIndex }: OpenSearchResultInput) {
  const session = await getActiveSession();
  const { page } = session;
  const rows = session.lastSearchRows ?? [];
  const query = session.lastSearchQuery?.trim() ?? "";

  if (rows.length === 0) {
    throw new Error("No previous portal search results are available. Search the portal first before opening a result row.");
  }

  const selectedRecord = rows[rowIndex];
  if (!selectedRecord) {
    throw new Error(`Invalid portal row index: ${rowIndex}`);
  }

  const clickedSelectedRecord = await openFacilityResult(page, rowIndex).catch(() => false);
  if (clickedSelectedRecord) {
    await waitForFacilityRecordReady(page, selectedRecord.facilityName || query, 2_500);
  }

  const openedText = await getVisibleText(page);
  const renewalSelection = buildRenewalSelectionFromRecord({
    rows,
    selectedRecord,
    openedText,
  });

  const currentSession = getSession();
  if (currentSession) {
    currentSession.renewalSelection = renewalSelection;
    currentSession.page = page;
    await persistPortalStorageState(currentSession);
    setSession(currentSession);
  }

  const status =
    renewalSelection.renewalStatus === "current_year"
      ? "opened_current_renewal"
      : renewalSelection.renewalStatus === "latest_available_previous_year"
        ? "opened_latest_available_renewal"
        : "opened_facility";

  return {
    status,
    url: page.url(),
    facilityName: query,
    currentRenewalYear: renewalSelection.currentRenewalYear,
    latestAvailableRenewalYear: renewalSelection.latestAvailableRenewalYear,
    matchCount: rows.length,
    matches: rows,
    renewalStatus: renewalSelection.renewalStatus,
    selectedPortalRecord: selectedRecord,
    selectedRenewalYear: renewalSelection.selectedRenewalYear,
    selectedRecordOpened: clickedSelectedRecord,
    note:
      renewalSelection.renewalStatus === "current_year"
        ? `Opened the ${renewalSelection.currentRenewalYear} current renewal portal record${query ? ` for ${query}` : ""}.`
        : `Opened the latest available portal renewal record (${renewalSelection.selectedRenewalYear ?? "unknown year"})${query ? ` for ${query}` : ""}; no ${renewalSelection.currentRenewalYear} record was found.`,
    visibleTextPreview: openedText.slice(0, 800),
  };
}


export async function captureCurrentPageText() {
  const session = await getActiveSession();
  const { page } = session;
  const [bodyText, formFields, tables] = await Promise.all([
    getVisibleText(page),
    getVisibleFormFields(page),
    getVisibleTables(page),
  ]);
  const selectedPortalRecord = inferPortalRecordFromCapture({
    bodyText,
    formFields,
    tables,
    renewalSelection: session.renewalSelection,
  });
  const currentRenewalYear = session.renewalSelection?.currentRenewalYear ?? getCurrentRenewalYear();
  const latestAvailableRenewalYear =
    session.renewalSelection?.latestAvailableRenewalYear ?? selectedPortalRecord?.renewalYear ?? null;
  const selectedRenewalYear = session.renewalSelection?.selectedRenewalYear ?? selectedPortalRecord?.renewalYear ?? null;
  const renewalStatus: PortalRenewalSelection["renewalStatus"] =
    session.renewalSelection?.renewalStatus ??
    (selectedRenewalYear === currentRenewalYear
      ? "current_year"
      : selectedRenewalYear
        ? "latest_available_previous_year"
        : "unknown_year");

  await persistPortalStorageState(session);

  return {
    text: buildPortalSnapshotText({
      bodyText,
      formFields,
      renewalSelection: session.renewalSelection,
      tables,
    }),
    bodyText,
    formFields,
    tables,
    currentRenewalYear,
    latestAvailableRenewalYear,
    selectedPortalRecord,
    selectedRenewalYear,
    renewalStatus,
  };
}

export async function getCurrentPortalUrl() {
  const session = await getActiveSession();
  return session.page.url();
}

export async function closePortal() {
  const session = getSession();
  portalRuntime.openingSession = null;

  if (!session) {
    return {
      status: "closed",
      persistentProfile: true,
      profileLocked: false,
      note: "Portal browser session is already closed.",
    };
  }

  setSession(null);
  await closePortalSession(session);
  const lock = getPortalProfileLock(session.profileDir);

  return {
    status: "closed",
    persistentProfile: true,
    profileLocked: lock.locked,
    profileLockPid: lock.pid,
    note: lock.locked
      ? "Portal browser session closed, but the old profile lock is still present. Release the stale lock before opening again."
      : "Portal browser session closed. Login cookies were saved locally for the next portal session.",
  };
}
