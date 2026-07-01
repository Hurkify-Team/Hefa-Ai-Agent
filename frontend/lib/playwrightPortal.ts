import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";

import { writePortalScanSnapshot } from "@/lib/portalScanSnapshots";
import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";

type PortalSession = {
  browser?: Browser | null;
  browserChannel?: string | null;
  context: BrowserContext;
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
type PortalScanMode = "quick" | "full";
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
  status: PortalScanEventStatus;
};

type PortalScanProgress = {
  completedAt: string | null;
  currentFacilityHefamaaId?: string | null;
  currentFacilityName?: string | null;
  detailTotal?: number;
  error?: string;
  failedDetails?: number;
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
  startedAt: string | null;
  status: PortalScanStatus;
};

export type PortalFacilityRecord = FacilitySearchResultRow & {
  applicationType: PortalApplicationType;
  normalizedStatus: PortalFacilityStatus;
  lastSeen: string;
};

type PortalStaffDetail = {
  matchedComplements: string[];
  rowIndex: number;
  tableIndex: number;
  text: string;
  values: string[];
};

export type PortalFacilityDetailRecord = {
  applicationType: PortalApplicationType;
  bodyText: string;
  cacheKey: string;
  capturedAt: string;
  category: string;
  facilityName: string;
  fieldIndex: Record<string, string>;
  formFields: VisibleFormField[];
  hefamaaId: string;
  normalizedStatus: PortalFacilityStatus;
  recordDate?: string | null;
  registrationStatus: string;
  renewalYear: number | null;
  sourceRecord: PortalFacilityRecord;
  staffComplement: Record<string, number>;
  staffDetails?: PortalStaffDetail[];
  tables: string[][][];
  text: string;
  url: string;
  visibleFields: Record<string, string>;
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

type PortalRuntimeStore = {
  cleanupHooksAttached: boolean;
  closingSession: Promise<void> | null;
  dedicatedBrowserPid?: number;
  keepAwakePid?: number;
  hostResolveCheckedAt: number;
  openingSession: Promise<PortalSession> | null;
  scanPromise: Promise<void> | null;
  scanProgress: PortalScanProgress;
  scanStopRequested: boolean;
  session: PortalSession | null;
};

const globalPortalRuntime = globalThis as typeof globalThis & {
  __hefamaaPortalRuntime?: PortalRuntimeStore;
};

const portalRuntime =
  globalPortalRuntime.__hefamaaPortalRuntime ??
  (globalPortalRuntime.__hefamaaPortalRuntime = {
    cleanupHooksAttached: false,
    closingSession: null,
    keepAwakePid: undefined,
    hostResolveCheckedAt: 0,
    openingSession: null,
    scanPromise: null,
    scanStopRequested: false,
    scanProgress: {
      completedAt: null,
      currentFacilityHefamaaId: null,
      currentFacilityName: null,
      detailTotal: 0,
      failedDetails: 0,
      lastCapturedFacilityName: null,
      portalReportedRecords: null,
      recentEvents: [],
      scanMode: "quick",
      scannedDetails: 0,
      scannedPages: 0,
      scannedRecords: 0,
      skippedDetails: 0,
      startedAt: null,
      status: "idle",
    },
    session: null,
  });

// Next.js hot reload can preserve the runtime object after new fields are added.
portalRuntime.closingSession ??= null;
portalRuntime.keepAwakePid ??= undefined;
portalRuntime.openingSession ??= null;
portalRuntime.scanPromise ??= null;
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

function portalRecordDisplayName(record: Pick<PortalFacilityRecord, "facilityName" | "hefamaaId">) {
  return cleanPortalText(record.facilityName) || cleanPortalText(record.hefamaaId) || "Unnamed facility";
}

function isPortalScanCancellationError(error: unknown) {
  return portalRuntime.scanStopRequested || /scan cancelled|scan stopped|cancelled by user/i.test(scanErrorMessage(error));
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

    await delay(200);
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
  if (mode !== "full" || !portalKeepAwakeEnabled()) return;

  const existingPid = portalRuntime.keepAwakePid;
  if (existingPid && isProcessRunning(existingPid)) return;

  try {
    // A full detail scan is long-running. Keep macOS awake so screen lock or idle sleep
    // does not freeze Chromium/CDP midway through a resumable capture.
    const child = spawn("caffeinate", ["-dimsu"], { detached: true, stdio: "ignore" });
    child.unref();
    portalRuntime.keepAwakePid = child.pid;
    appendPortalScanEvent({
      message: "Mac keep-awake guard started for Full Detail Scan.",
      status: "info",
    });
  } catch (error) {
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
  if (!pid) return;
  await terminateProcess(pid, 1_500);
}

async function persistPortalStorageState(session: PortalSession) {
  const storageStatePath = session.storageStatePath ?? getPortalStorageStatePath();
  ensureRuntimeDataDirForFile(storageStatePath);
  await session.context.storageState({ path: storageStatePath }).catch(() => undefined);
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
  if (executable && existsSync(/*turbopackIgnore: true*/ executable)) return "Google Chrome";
  return "bundled Playwright Chromium";
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
    `Portal browser profile is already open${pidText}. Close the existing HEFAMAA portal Chrome window that uses ${profileName(
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
    profileLocked: finalLock.locked,
    profileLockPid: finalLock.pid,
    note: finalLock.locked
      ? `Portal profile is still locked${finalLock.pid ? ` by process ${finalLock.pid}` : ""}. Close the HEFAMAA portal Chrome window manually.`
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

async function pageHasFacilitiesGrid(page: Page) {
  return (await page.locator("#mainGrid").count().catch(() => 0)) > 0;
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

async function clickFacilityNavigationCandidate(page: Page) {
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
    await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
    await page.waitForTimeout(800).catch(() => undefined);
    await waitForManualPortalLogin(page, 120_000);
    if (await pageHasFacilitiesGrid(page)) return true;

    if (page.url() !== beforeUrl) {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 10_000 }).catch(() => undefined);
      await page.waitForTimeout(500).catch(() => undefined);
    }
  }

  return false;
}

async function openFacilitiesGrid(page: Page) {
  await waitForManualPortalLogin(page, 120_000);

  if (await pageHasFacilitiesGrid(page)) return;

  updatePortalScanProgress({
    message: "Opening the HEFAMAA facilities table...",
    phase: "finding_facilities",
  });

  const routeCandidates = getFacilityRouteCandidateUrls();
  for (const url of routeCandidates) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(800).catch(() => undefined);
    await waitForManualPortalLogin(page, 120_000);
    if (await pageHasFacilitiesGrid(page)) return;
  }

  await page.goto(getPortalHomeUrl(), { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
  await page.waitForTimeout(800).catch(() => undefined);
  await waitForManualPortalLogin(page, 120_000);
  if (await pageHasFacilitiesGrid(page)) return;

  const hrefs = Array.from(new Set(await collectFacilityNavigationHrefs(page)));
  for (const href of hrefs) {
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(800).catch(() => undefined);
    await waitForManualPortalLogin(page, 120_000);
    if (await pageHasFacilitiesGrid(page)) return;
  }

  if (await clickFacilityNavigationCandidate(page)) return;

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
      .filter((page) => page !== keepPage && isBlankOrNewTab(page))
      .map((page) => page.close().catch(() => undefined)),
  );
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
        message: "Primary portal browser could not be controlled. Opening a clean Google Chrome recovery profile so the scan can continue after login.",
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
            message: "Existing portal browser rejected Playwright reconnect. Restarting Google Chrome and resuming from cache.",
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
          message: "Dedicated portal browser was not controllable. Restarting Google Chrome with a clean recovery profile.",
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
        "Timed out opening the HEFAMAA portal browser with " + browserChannelLabel(browserChannel) + ". Chrome profile files were cleared automatically. Close any stuck HEFAMAA Chrome window, then try Full Detail Scan again; already captured facilities will be skipped.",
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
    const launched = await launchPersistentPortalContext(profileDir);
    browser = launched.browser;
    context = launched.context;
    const page = (await waitForInitialPage(context, options.fastOpen ? 1_500 : 10_000)) ?? (await context.newPage());

    page.setDefaultTimeout(15_000);

    if (isBlankOrNewTab(page) || !isPortalPage(page)) {
      await withTimeout(
        navigateToPortal(page, { fast: options.fastOpen }),
        options.fastOpen ? 12_000 : 45_000,
        `Timed out loading ${getPortalUrl()} in the HEFAMAA portal browser.`,
      );
    } else if (!options.fastOpen) {
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
    }

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
      "Stale HEFAMAA portal browser session detected. Reconnecting Chrome once and resuming from cached scan progress.",
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
      "Stale HEFAMAA portal browser session detected while opening the portal. Reconnecting Chrome once.",
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
    page.setDefaultTimeout(15_000);

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
    setSession(session);
    return session;
  } catch (error) {
    console.warn("[portal/session] existing dedicated portal session is not reusable", scanErrorMessage(error));
    return null;
  }
}

async function requireActivePortalSessionForScan(mode: PortalScanMode) {
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

  const session = currentSession ?? await reconnectExistingDedicatedPortalSession();
  if (session && !session.page.isClosed() && await isPortalSessionHealthy(session, 1_200)) {
    const page = choosePortalPage(session.context, session.page) ?? session.page;
    session.page = page;
    session.lastActivity = new Date().toISOString();
    setSession(session);
    return session;
  }

  const label = mode === "full" ? "Full Scan" : "Quick Scan";
  throw new Error("Please click Open Portal and login first before running " + label + ".");
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
    await page.waitForTimeout(500).catch(() => undefined);
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

    for (const line of lines) {
      const match = line.match(pattern);
      if (match?.[1]) return cleanPortalText(match[1]);
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
    timeout: 20_000,
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
  await waitForDataTableIdle(page, 1_800);
  await page.waitForTimeout(120);
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
  const [bodyText, formFields, tables] = await Promise.all([
    getVisibleText(page),
    getVisibleFormFields(page),
    getVisibleTables(page),
  ]);
  const fieldIndex = buildDetailFieldIndex({ bodyText, formFields, sourceRecord, tables });
  const staffComplement = countStaffComplement({ bodyText, fieldIndex, tables });
  // Counts are useful for sheet columns, while staffDetails preserves the complete staff rows for AI answers and exports.
  const staffDetails = extractStaffDetails(tables);
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
  const visibleFields = {
    ...(sourceRecord.visibleFields ?? {}),
    ...Object.fromEntries(formFields.map((field) => [field.label, field.value])),
    ...fieldIndex,
    ...staffFields,
    ...staffDetailFields,
  };
  const text = [buildPortalSnapshotText({ bodyText, formFields, tables }), staffDetailsText].filter(Boolean).join("\n");

  return {
    applicationType: sourceRecord.applicationType,
    bodyText,
    cacheKey: portalDetailCacheKey(sourceRecord),
    capturedAt: new Date().toISOString(),
    category: sourceRecord.category,
    facilityName: sourceRecord.facilityName,
    fieldIndex,
    formFields,
    hefamaaId: sourceRecord.hefamaaId,
    normalizedStatus: sourceRecord.normalizedStatus,
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
      await page.waitForTimeout(120).catch(() => undefined);
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
  await page.waitForSelector("#mainGrid", { timeout: 1_500 }).catch(() => undefined);
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
) {
  const expectedKeys = new Set(expectedRecords.map((record) => portalDetailCacheKey(record)));
  const detailMap = portalDetailCacheMap();
  let scannedDetails = Array.from(expectedKeys).filter((key) => detailMap.has(key)).length;
  let failedDetails = 0;
  let skippedDetails = 0;

  updatePortalScanProgress({
    currentFacilityHefamaaId: null,
    currentFacilityName: null,
    detailTotal: expectedRecords.length,
    failedDetails,
    lastCapturedFacilityName: null,
    message: "Capturing latest valid facility details for offline AI answers...",
    phase: "capturing_details",
    scannedDetails,
    skippedDetails,
  });

  if (!expectedRecords.length || scannedDetails >= expectedRecords.length) {
    updatePortalScanProgress({
      message: expectedRecords.length
        ? "All latest valid facility detail records are already cached; full scan reused the saved captures."
        : "No latest valid facility records were available for detail capture.",
      scannedDetails,
    });
    return Array.from(detailMap.values());
  }

  throwIfPortalScanStopped();
  await openFacilitiesGrid(page);
  await page.waitForSelector("#mainGrid", { timeout: 30_000 });
  await prepareFacilityGridForFullScan(page).catch(() => undefined);

  for (let recordIndex = 0; recordIndex < expectedRecords.length; recordIndex += 1) {
    throwIfPortalScanStopped();
    const expectedRecord = expectedRecords[recordIndex];
    const key = portalDetailCacheKey(expectedRecord);
    if (detailMap.has(key)) continue;

    const facilityName = portalRecordDisplayName(expectedRecord);
    const detailIndex = recordIndex + 1;

    appendPortalScanEvent({
      category: expectedRecord.category,
      detailIndex,
      detailTotal: expectedRecords.length,
      facilityName,
      hefamaaId: expectedRecord.hefamaaId,
      message: "Capturing " + facilityName + " now...",
      status: "capturing",
    });
    updatePortalScanProgress({
      currentFacilityHefamaaId: expectedRecord.hefamaaId || null,
      currentFacilityName: facilityName,
      detailTotal: expectedRecords.length,
      failedDetails,
      message: "Capturing " + facilityName + " now...",
      phase: "capturing_details",
      scannedDetails,
      skippedDetails,
    });

    let beforeUrl = page.url();
    let beforeFingerprint = "";

    try {
      throwIfPortalScanStopped();
      const searchResult = await searchExpectedPortalRecord(page, expectedRecord);
      throwIfPortalScanStopped();
      if (!searchResult) {
        skippedDetails += 1;
        appendPortalScanEvent({
          category: expectedRecord.category,
          detailIndex,
          detailTotal: expectedRecords.length,
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
        });
        continue;
      }

      const sourceRecord = mergeExpectedRecordWithPortalRow(expectedRecord, searchResult.selectedRow);
      beforeUrl = page.url();
      beforeFingerprint = await facilityTableFingerprint(page).catch(() => "");

      const clicked = await openFacilityResult(page, searchResult.selectedRow.index).catch(() => false);
      throwIfPortalScanStopped();
      if (!clicked) {
        skippedDetails += 1;
        appendPortalScanEvent({
          category: sourceRecord.category,
          detailIndex,
          detailTotal: expectedRecords.length,
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
        });
        continue;
      }

      await waitForFacilityRecordReady(page, sourceRecord.facilityName || facilityName, 2_500);

      let detail: PortalFacilityDetailRecord;
      try {
        detail = await captureFacilityDetailRecord(page, sourceRecord);
      } catch (firstCaptureError) {
        await page.waitForLoadState("domcontentloaded", { timeout: 5_000 }).catch(() => undefined);
        await waitForFacilityRecordReady(page, sourceRecord.facilityName || facilityName, 2_000);
        detail = await captureFacilityDetailRecord(page, sourceRecord).catch((secondCaptureError) => {
          throw new Error(scanErrorMessage(secondCaptureError) + " | first attempt: " + scanErrorMessage(firstCaptureError));
        });
      }

      throwIfPortalScanStopped();
      detailMap.set(key, { ...detail, cacheKey: key, sourceRecord });
      scannedDetails += 1;
      writePortalFacilityDetailsCache(Array.from(detailMap.values()));
      appendPortalScanEvent({
        category: sourceRecord.category,
        detailIndex,
        detailTotal: expectedRecords.length,
        facilityName,
        hefamaaId: sourceRecord.hefamaaId,
        message: facilityName + " captured successfully.",
        status: "captured",
      });
      updatePortalScanProgress({
        currentFacilityHefamaaId: null,
        currentFacilityName: null,
        detailTotal: expectedRecords.length,
        failedDetails,
        lastCapturedFacilityName: facilityName,
        message: facilityName + " captured successfully. Capturing next facility...",
        phase: "capturing_details",
        scannedDetails,
        skippedDetails,
      });
    } catch (error) {
      if (isPortalScanCancellationError(error)) {
        throw new Error("Portal scan cancelled by user.");
      }

      if (page.isClosed() || isPortalTargetClosedError(error)) {
        throw new Error("Portal browser closed during full detail scan: " + scanErrorMessage(error));
      }

      failedDetails += 1;
      const errorMessage = scanErrorMessage(error);
      console.warn("[portal/scan] detail capture failed", { facilityName, hefamaaId: expectedRecord.hefamaaId, error: errorMessage });
      appendPortalScanEvent({
        category: expectedRecord.category,
        detailIndex,
        detailTotal: expectedRecords.length,
        error: errorMessage,
        facilityName,
        hefamaaId: expectedRecord.hefamaaId,
        message: facilityName + " could not be captured; moving to the next facility.",
        status: "failed",
      });
      updatePortalScanProgress({
        currentFacilityHefamaaId: null,
        currentFacilityName: null,
        failedDetails,
        message: facilityName + " could not be captured. Continuing with the next facility.",
        scannedDetails,
        skippedDetails,
      });
    } finally {
      if (!portalRuntime.scanStopRequested && !page.isClosed()) {
        await restoreFacilityGridAfterDetail(page, beforeUrl, beforeFingerprint).catch(async (restoreError) => {
          const errorMessage = scanErrorMessage(restoreError);
          if (portalRuntime.scanStopRequested || page.isClosed() || isPortalTargetClosedError(restoreError)) {
            return;
          }

          console.warn("[portal/scan] failed to restore facility grid", errorMessage);
        appendPortalScanEvent({
          error: errorMessage,
          message: "The portal grid needed recovery after " + facilityName + ". Reopening the facilities table.",
          status: "info",
        });
        await openFacilitiesGrid(page).catch(() => undefined);
          await page.waitForSelector("#mainGrid", { timeout: 15_000 }).catch(() => undefined);
        });
      }
    }
  }

  const details = Array.from(detailMap.values());
  writePortalFacilityDetailsCache(details);
  updatePortalScanProgress({
    currentFacilityHefamaaId: null,
    currentFacilityName: null,
    failedDetails,
    scannedDetails,
    skippedDetails,
  });
  return details;
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
    await lengthSelector.selectOption("100");
    await page.waitForFunction(() => document.querySelectorAll("#mainGrid tbody tr").length >= 50 || !document.querySelector("#mainGrid_next:not(.disabled)"), null, { timeout: 30_000 }).catch(() => undefined);
    await page.waitForFunction(() => {
      const processing = document.querySelector<HTMLElement>("#mainGrid_processing");
      return !processing || processing.style.display === "none";
    }, null, { timeout: 30_000 }).catch(() => undefined);
  }

  const info = await page.locator("#mainGrid_info").innerText().catch(() => "");
  if (!/Showing\s+1\s+to/i.test(info)) {
    const firstPage = page.locator("#mainGrid_paginate .paginate_button:not(.previous):not(.next) a").first();
    if (await firstPage.count()) {
      await firstPage.click();
      await page.waitForFunction(() => /Showing\s+1\s+to/i.test(document.querySelector("#mainGrid_info")?.textContent ?? ""), null, { timeout: 30_000 }).catch(() => undefined);
    }
  }
}

async function clickNextFacilityPage(page: Page, currentFingerprint: string) {
  const next = page.locator("#mainGrid_next:not(.disabled) a");
  if (!(await next.count())) return false;

  await next.click();
  await page.waitForFunction(
    (previousFingerprint) => {
      const processing = document.querySelector<HTMLElement>("#mainGrid_processing");
      const fingerprint = document.querySelector("#mainGrid tbody")?.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return (!processing || processing.style.display === "none") && Boolean(fingerprint) && fingerprint !== previousFingerprint;
    },
    currentFingerprint.replace(/\s+/g, " ").trim(),
    { timeout: 30_000 },
  );
  return true;
}

async function scanFacilityList(
  page: Page,
  maxPages = 500,
  onProgress?: (progress: PortalScanProgress) => void,
  onRecords?: (records: PortalFacilityRecord[]) => void,
) {
  await openFacilitiesGrid(page);

  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  if (!(await page.locator("#mainGrid").count())) {
    const title = await page.title().catch(() => "HEFAMAA portal");
    throw new Error("The HEFAMAA facilities table is not visible on " + title + ". Open the portal, log in if required, then run Full Detail Scan again.");
  }

  await prepareFacilityGridForFullScan(page);
  const portalReportedRecords = await readPortalReportedRecordCount(page);
  const gathered: PortalFacilityRecord[] = [];
  const seenPages = new Set<string>();

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const currentRows = await getFacilityResultRows(page);
    const domFingerprint = await facilityTableFingerprint(page);
    const pageFingerprint = currentRows.map((row) => `${row.hefamaaId}|${row.facilityName}|${row.registrationStatus}`).join("::");

    if (pageFingerprint && seenPages.has(pageFingerprint)) {
      break;
    }

    if (pageFingerprint) {
      seenPages.add(pageFingerprint);
    }

    const currentRecords = currentRows.map((row) => {
      const normalizedStatus = normalizePortalStatus(row.registrationStatus, row.renewalYear);

      return {
        ...row,
        applicationType: inferPortalApplicationType(row, normalizedStatus),
        normalizedStatus,
        lastSeen: new Date().toISOString(),
      };
    });

    gathered.push(...currentRecords);
    if ((pageIndex + 1) % 5 === 0) {
      onRecords?.(classifyPortalFacilityRecords(dedupeFacilityRecords(gathered)));
    }
    onProgress?.({
      completedAt: null,
      message: "Indexing portal facility list...",
      phase: "indexing_list",
      portalReportedRecords,
      scannedPages: pageIndex + 1,
      scannedRecords: gathered.length,
      startedAt: portalRuntime.scanProgress.startedAt,
      status: "running",
    });

    const hasNext = await clickNextFacilityPage(page, domFingerprint);
    if (!hasNext) break;
  }

  const records = classifyPortalFacilityRecords(dedupeFacilityRecords(gathered));
  onRecords?.(records);
  return { portalReportedRecords, records };
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

export async function scanAllPortalFacilities(mode: PortalScanMode = "quick") {
  throwIfPortalScanStopped();
  const session = await requireActivePortalSessionForScan(mode);
  const primaryPage = session.page && !session.page.isClosed() ? session.page : null;
  if (primaryPage) {
    await waitForManualPortalLogin(primaryPage, 120_000);
  }

  if (!primaryPage) {
    throw new Error("Please click Open Portal and login first before running " + (mode === "full" ? "Full Scan" : "Quick Scan") + ".");
  }

  const scanPage = primaryPage;
  scanPage.setDefaultTimeout(10_000);
  let partialRecords: PortalFacilityRecord[] = [];
  let lastPartialWriteCount = 0;

  try {
    throwIfPortalScanStopped();
    const cachedRecords = classifyPortalFacilityRecords(readPortalFacilityCache());
    const shouldReuseListCache = mode === "full" && cachedRecords.length > 0;
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
            detailTotal: mode === "full" ? portalRuntime.scanProgress.detailTotal ?? 0 : 0,
            scanMode: mode,
            scannedDetails: mode === "full" ? portalRuntime.scanProgress.scannedDetails ?? 0 : 0,
          });
        },
        (recordsSoFar) => {
          partialRecords = recordsSoFar;
          if (recordsSoFar.length - lastPartialWriteCount >= 500) {
            writePortalFacilityCache(stampPortalScanRecords(recordsSoFar));
            lastPartialWriteCount = recordsSoFar.length;
          }
        },
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
    const detailTargetRecords = latestDetailTargetRecords(datedRecords);
    const detailRecords = mode === "full"
      ? await capturePortalFacilityDetails(scanPage, detailTargetRecords)
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
      detailTotal: mode === "full" ? detailTargetRecords.length : portalRuntime.scanProgress.detailTotal ?? 0,
      lastCapturedFacilityName: mode === "full" ? portalRuntime.scanProgress.lastCapturedFacilityName ?? null : null,
      message: mode === "full"
        ? "Full detail scan completed. Captured " + capturedCurrentDetails + " of " + detailTargetRecords.length + " latest valid facility detail records."
        : "Quick portal scan completed. Indexed " + datedRecords.length + " portal rows.",
      phase: "completed",
      portalReportedRecords,
      scanMode: mode,
      scannedDetails: mode === "full" ? capturedCurrentDetails : portalRuntime.scanProgress.scannedDetails ?? 0,
      scannedPages: portalRuntime.scanProgress.scannedPages,
      scannedRecords: datedRecords.length,
      startedAt: portalRuntime.scanProgress.startedAt,
      status: "completed",
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
    }
  }
}

export async function startPortalFacilityScan(input: { mode?: PortalScanMode } = {}) {
  const mode = input.mode ?? "quick";
  if (portalRuntime.scanPromise) {
    if (portalRuntime.scanProgress.status === "running" && !portalRuntime.scanStopRequested) {
      return getFastPortalFacilitySummary();
    }

    portalRuntime.scanPromise = null;
    portalRuntime.openingSession = null;
  }

  await requireActivePortalSessionForScan(mode);

  portalRuntime.scanStopRequested = false;
  const startedAt = new Date().toISOString();
  updatePortalScanProgress({
    completedAt: null,
    currentFacilityHefamaaId: null,
    currentFacilityName: null,
    detailTotal: 0,
    error: undefined,
    failedDetails: 0,
    lastCapturedFacilityName: null,
    message: mode === "full" ? "Starting full detail scan for latest valid facility records..." : "Starting quick portal scan...",
    phase: "starting",
    portalReportedRecords: null,
    recentEvents: [createPortalScanEvent({
      message: mode === "full" ? "Full detail scan started." : "Quick portal scan started.",
      status: "info",
    })],
    scanMode: mode,
    scannedDetails: 0,
    scannedPages: 0,
    scannedRecords: 0,
    skippedDetails: 0,
    startedAt,
    status: "running",
  });

  startPortalScanKeepAwake(mode);

  // The promise is kept in module state so a full detail scan can continue while the user navigates the app.
  const scanPromise = scanAllPortalFacilities(mode)
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
    });
  portalRuntime.scanPromise = scanPromise;

  return getFastPortalFacilitySummary();
}

export async function stopPortalFacilityScan() {
  if (!portalRuntime.scanPromise && portalRuntime.scanProgress.status !== "running") {
    return getFastPortalFacilitySummary();
  }

  portalRuntime.scanStopRequested = true;
  await stopPortalScanKeepAwake();
  appendPortalScanEvent({
    message: "Stop requested. Closing the portal scan session after the current operation...",
    status: "info",
  });
  updatePortalScanProgress({
    completedAt: new Date().toISOString(),
    currentFacilityHefamaaId: null,
    currentFacilityName: null,
    message: "Portal scan stop requested. Already captured details are saved and will be skipped on restart.",
    status: "cancelled",
  });

  const session = getSession();
  if (session) {
    setSession(null);
    portalRuntime.openingSession = null;
    const closingSession = closePortalSession(session, 8_000).catch(() => undefined);
    portalRuntime.closingSession = closingSession.finally(() => {
      if (portalRuntime.closingSession === closingSession) portalRuntime.closingSession = null;
    });
  }

  return getFastPortalFacilitySummary();
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

  await page.waitForTimeout(250).catch(() => undefined);
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
  const currentSession = getSession();

  if (currentSession && !currentSession.page.isClosed()) {
    const { page } = await openPortalTab({ fastOpen: true });
    return {
      status: "opened",
      url: page.url(),
      requiresManualLogin: true,
      persistentProfile: true,
      browserChannel: browserChannelLabel(currentSession.browserChannel ?? getPortalBrowserChannel()),
      profileName: profileName(currentSession.profileDir),
      note: "HEFAMAA portal browser is already active and has been brought to the front.",
    };
  }

  if (await portalDebuggingEndpointReady(getPortalDebuggingPort())) {
    const session = await ensureSession({ fastOpen: true }).catch(() => null);
    if (session && !session.page.isClosed()) {
      return {
        status: "opened",
        url: session.page.url(),
        requiresManualLogin: true,
        persistentProfile: true,
        browserChannel: browserChannelLabel(session.browserChannel ?? getPortalBrowserChannel()),
        profileName: profileName(session.profileDir),
        note: "Reconnected to the existing HEFAMAA portal Chrome window and brought it to the front.",
      };
    }
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
    note: "HEFAMAA portal browser launch requested. The dedicated portal window is opening in the background; log in manually if requested. Search and capture will reuse it when ready.",
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
    profileLocked: !active && !opening && !debuggingReady && lock.locked,
    profileLockPid: !active && !opening && !debuggingReady ? lock.pid : undefined,
    note: active
      ? "Portal browser session is active. Search, capture, quick scan, and full scan will reuse this dedicated HEFAMAA Chrome window."
      : reusableDedicatedBrowser
        ? "Dedicated HEFAMAA portal Chrome is running and reachable. The agent will reconnect to it automatically."
        : opening
          ? "Dedicated portal browser is starting in the background. It will reuse the saved HEFAMAA profile and become available for search and capture shortly."
          : lock.locked
            ? `Portal profile is locked${lock.pid ? ` by process ${lock.pid}` : ""}. If this is the old HEFAMAA portal Chrome window, close it or use Release Lock before opening again.`
            : "Portal browser is closed. Opening it will reuse the saved HEFAMAA profile if the portal session is still valid.",
  };
}

async function detectFacilityListPage(page: Page) {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").toLowerCase();
      const tableLike = document.querySelectorAll("table tbody tr, [role='row'], .ag-row, .dx-row, tr").length;
      const hasFacilityWords = /facility|facilities|hefamaa|hef\/?no|registration status|category/.test(text);
      const hasListWords = /search|filter|records|showing|entries|renewal|new registration/.test(text);
      return Boolean(tableLike >= 3 && hasFacilityWords && hasListWords);
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
      return !/login to your account|sign in|forgot password/.test(text);
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
  const loggedIn = browserOpen && session ? await detectLoggedInPage(session.page) : false;
  const facilityListDetected = browserOpen && session ? await detectFacilityListPage(session.page) : false;
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
    scanProgress: portalRuntime.scanProgress,
  };
}

export const PortalSessionManager = {
  close: closePortal,
  getSession,
  open: openPortal,
  requireSessionForScan: requireActivePortalSessionForScan,
  status: getPortalSessionManagerStatus,
};

export async function searchFacility({ facilityName }: SearchFacilityInput) {
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

  const shouldOpenSelectedRecord = true;
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

  if (!session) {
    return {
      status: "closed",
      persistentProfile: true,
      profileLocked: false,
      note: "Portal browser session is already closed.",
    };
  }

  setSession(null);
  portalRuntime.openingSession = null;
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
