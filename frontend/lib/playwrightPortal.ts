import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";

import { writePortalScanSnapshot } from "@/lib/portalScanSnapshots";

type PortalSession = {
  browser?: Browser | null;
  browserChannel?: string | null;
  context: BrowserContext;
  page: Page;
  profileDir: string;
  storageStatePath?: string;
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
type PortalScanStatus = "idle" | "running" | "completed" | "failed";

type PortalScanProgress = {
  completedAt: string | null;
  error?: string;
  portalReportedRecords: number | null;
  scannedPages: number;
  scannedRecords: number;
  startedAt: string | null;
  status: PortalScanStatus;
};

export type PortalFacilityRecord = FacilitySearchResultRow & {
  applicationType: PortalApplicationType;
  normalizedStatus: PortalFacilityStatus;
  lastSeen: string;
};

type PortalFacilitySummary = {
  totalFacilities: number;
  totalPortalRecords: number;
  portalReportedRecords: number | null;
  categoryCounts: Array<{ category: string; count: number }>;
  categoryPortalRecordCounts: Array<{ category: string; count: number }>;
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

type PortalRuntimeStore = {
  cleanupHooksAttached: boolean;
  dedicatedBrowserPid?: number;
  hostResolveCheckedAt: number;
  openingSession: Promise<PortalSession> | null;
  scanPromise: Promise<void> | null;
  scanProgress: PortalScanProgress;
  session: PortalSession | null;
};

const globalPortalRuntime = globalThis as typeof globalThis & {
  __hefamaaPortalRuntime?: PortalRuntimeStore;
};

const portalRuntime =
  globalPortalRuntime.__hefamaaPortalRuntime ??
  (globalPortalRuntime.__hefamaaPortalRuntime = {
    cleanupHooksAttached: false,
    hostResolveCheckedAt: 0,
    openingSession: null,
    scanPromise: null,
    scanProgress: {
      completedAt: null,
      portalReportedRecords: null,
      scannedPages: 0,
      scannedRecords: 0,
      startedAt: null,
      status: "idle",
    },
    session: null,
  });

// Next.js hot reload can preserve the runtime object after new fields are added.
portalRuntime.openingSession ??= null;
portalRuntime.scanPromise ??= null;
portalRuntime.scanProgress ??= {
  completedAt: null,
  portalReportedRecords: null,
  scannedPages: 0,
  scannedRecords: 0,
  startedAt: null,
  status: "idle",
};

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

async function persistPortalStorageState(session: PortalSession) {
  const storageStatePath = session.storageStatePath ?? getPortalStorageStatePath();
  mkdirSync(path.dirname(storageStatePath), { recursive: true });
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
  const configuredDir = process.env.HEFAMAA_PORTAL_PROFILE_DIR?.trim() || "data/portal-profile";
  return path.isAbsolute(configuredDir) ? configuredDir : path.join(process.cwd(), configuredDir);
}

function getPortalStorageStatePath() {
  const configuredPath = process.env.HEFAMAA_PORTAL_STORAGE_STATE?.trim() || "data/portal-storage-state.json";
  return path.isAbsolute(configuredPath) ? configuredPath : path.join(process.cwd(), configuredPath);
}

function profileName(profileDir: string) {
  return path.relative(process.cwd(), profileDir) || profileDir;
}

function storageStateName(storageStatePath: string) {
  return path.relative(process.cwd(), storageStatePath) || storageStatePath;
}

function getPortalBrowserChannel() {
  const configuredChannel = process.env.HEFAMAA_PORTAL_BROWSER_CHANNEL?.trim();

  if (!configuredChannel) {
    return "chrome";
  }

  return /^(bundled|playwright|chromium)$/i.test(configuredChannel) ? undefined : configuredChannel;
}

function browserChannelLabel(channel: string | undefined | null) {
  return channel || "bundled Playwright Chromium";
}

function getPortalDebuggingPort() {
  const configuredPort = Number(process.env.HEFAMAA_PORTAL_DEBUG_PORT);
  return Number.isInteger(configuredPort) && configuredPort >= 1024 && configuredPort <= 65535 ? configuredPort : 9333;
}

function getPortalChromeExecutable(defaultExecutable: string) {
  const configuredExecutable = process.env.HEFAMAA_PORTAL_BROWSER_EXECUTABLE?.trim();
  if (configuredExecutable) return configuredExecutable;

  const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return existsSync(macChrome) ? macChrome : defaultExecutable;
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
  const lockPath = path.join(profileDir, "SingletonLock");

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
    for (const lockFile of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
      rmSync(path.join(profileDir, lockFile), { force: true });
    }
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

  return pages.find(isPortalPage) ?? preferred ?? pages.find((page) => !isBlankOrNewTab(page)) ?? pages[0] ?? null;
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

async function launchPersistentPortalContext(profileDir: string) {
  const { chromium } = await import("playwright");
  const browserChannel = getPortalBrowserChannel();
  const storageStatePath = getPortalStorageStatePath();
  const debuggingPort = getPortalDebuggingPort();
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(path.dirname(storageStatePath), { recursive: true });

  try {
    if (!(await portalDebuggingEndpointReady(debuggingPort))) {
      const lock = getPortalProfileLock(profileDir);
      if (lock.locked) throw portalProfileLockedError(lock, profileDir);

      const executable = getPortalChromeExecutable(chromium.executablePath());
      const child = spawn(
        executable,
        [
          `--remote-debugging-port=${debuggingPort}`,
          `--user-data-dir=${profileDir}`,
          "--start-maximized",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-infobars",
          "--disable-popup-blocking",
          "--disable-blink-features=AutomationControlled",
          getPortalUrl(),
        ],
        { detached: true, stdio: "ignore" },
      );
      child.unref();
      portalRuntime.dedicatedBrowserPid = child.pid;
      await waitForPortalDebuggingEndpoint(debuggingPort);
    }

    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debuggingPort}`, { timeout: 5_000 });
    const context = browser.contexts()[0];
    if (!context) throw new Error("Dedicated HEFAMAA portal browser opened without an accessible browser context.");

    return { browser, browserChannel, context, storageStatePath };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (/Timeout|Timed out/i.test(message)) {
      throw new Error(
        `Timed out opening the dedicated HEFAMAA portal browser with ${browserChannelLabel(browserChannel)}. Close an old HEFAMAA portal window or release the profile lock, then try again.`,
      );
    }

    throw error;
  }
}

async function ensureSession(options: { fastOpen?: boolean } = {}) {
  const currentSession = getSession();

  if (currentSession && !currentSession.page.isClosed()) {
    return currentSession;
  }

  const profileDir = getPortalProfileDir();
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  if (!options.fastOpen) {
    await verifyPortalHostResolves();
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

    const nextSession = {
      browser: launched.browser,
      browserChannel: launched.browserChannel,
      context,
      page,
      profileDir,
      storageStatePath: launched.storageStatePath,
    };
    setSession(nextSession);

    if (!portalRuntime.cleanupHooksAttached) {
      portalRuntime.cleanupHooksAttached = true;
      process.once("SIGINT", () => {
        const session = getSession();
        if (session) void closePortalSession(session);
      });
      process.once("SIGTERM", () => {
        const session = getSession();
        if (session) void closePortalSession(session);
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

async function openPortalTab(options: { fastOpen?: boolean } = {}) {
  const currentSession = getSession();

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

async function getActiveSession() {
  const openingSession = portalRuntime.openingSession;
  if (!getSession() && openingSession) {
    await openingSession;
  }

  if (!getSession() && (await portalDebuggingEndpointReady(getPortalDebuggingPort()))) {
    await ensureSession({ fastOpen: true });
  }

  const currentSession = getSession();

  if (currentSession) {
    const activePage = currentSession.page && !currentSession.page.isClosed()
      ? currentSession.page
      : currentSession.context.pages().find((page) => !page.isClosed()) ?? null;

    if (activePage) {
      currentSession.page = activePage;
      await activePage.bringToFront().catch(() => undefined);
      setSession(currentSession);
      return currentSession;
    }
  }

  throw new Error("Portal browser session is not active. Click Open HEFAMAA Portal, log in if needed, then search or capture.");
}

async function getVisibleText(page: Page) {
  return page.locator("body").innerText({ timeout: 15_000 });
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
  const facilitiesUrl = getFacilitiesUrl();
  const isFacilitiesPage = page.url().startsWith(facilitiesUrl);
  const existingInput = isFacilitiesPage ? await firstVisibleFacilitySearchInput(page) : null;

  if (existingInput) {
    return existingInput;
  }

  await page.goto(facilitiesUrl, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => undefined);
  await page.waitForSelector("#mainGrid-search-txt, input[placeholder*='Search' i], input[type='search']", {
    timeout: 20_000,
  }).catch(() => undefined);

  return firstVisibleFacilitySearchInput(page);
}

async function waitForFacilitySearchResults(page: Page, query: string) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => undefined);
  await page.waitForFunction(
    () => !document.body.innerText.toLowerCase().includes("processing..."),
    null,
    { timeout: 20_000 },
  ).catch(() => undefined);
  await page.waitForFunction(
    (facilityName) => document.body.innerText.toLowerCase().includes(String(facilityName).toLowerCase()),
    query,
    { timeout: 20_000 },
  ).catch(() => undefined);
  await page.waitForTimeout(800);
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

function facilityRecordKey(record: FacilitySearchResultRow) {
  return [normalizeSelectionName(record.facilityName), normalizeSelectionName(record.category)].join("|");
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
  const latest = new Map<string, PortalFacilityRecord>();

  for (const record of records) {
    const key = facilityRecordKey(record);
    const existing = latest.get(key);
    if (!existing || (record.renewalYear ?? 0) > (existing.renewalYear ?? 0)) latest.set(key, record);
  }

  return Array.from(latest.values());
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
  const configuredPath = process.env.HEFAMAA_PORTAL_FACILITIES_CACHE?.trim() || "data/portal-facilities-cache.json";
  return path.isAbsolute(configuredPath) ? configuredPath : path.join(process.cwd(), configuredPath);
}

function readPortalFacilityCache(): PortalFacilityRecord[] {
  const cachePath = portalFacilityCachePath();

  if (!existsSync(cachePath)) {
    return [];
  }

  try {
    const raw = readFileSync(cachePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // ignore invalid cache data
  }

  return [];
}

function writePortalFacilityCache(records: PortalFacilityRecord[]) {
  const cachePath = portalFacilityCachePath();
  mkdirSync(path.dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify(records, null, 2), "utf8");
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
  if (!page.url().startsWith(getFacilitiesUrl())) {
    await page.goto(getFacilitiesUrl(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(800);

  if (!(await page.locator("#mainGrid").count())) {
    const title = await page.title().catch(() => "HEFAMAA portal");
    throw new Error("The HEFAMAA facilities table is not visible on " + title + ". Open the portal, log in if required, then run Full Scan again.");
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

export async function scanAllPortalFacilities() {
  const session = await ensureSession({ fastOpen: false });
  const primaryPage = session.page && !session.page.isClosed() ? session.page : null;
  const scanPage = await session.context.newPage();
  scanPage.setDefaultTimeout(15_000);
  let partialRecords: PortalFacilityRecord[] = [];
  let lastPartialWriteCount = 0;

  try {
    const { portalReportedRecords, records } = await scanFacilityList(
      scanPage,
      500,
      (progress) => {
        portalRuntime.scanProgress = progress;
      },
      (recordsSoFar) => {
        partialRecords = recordsSoFar;
        if (recordsSoFar.length - lastPartialWriteCount >= 500) {
          writePortalFacilityCache(stampPortalScanRecords(recordsSoFar));
          lastPartialWriteCount = recordsSoFar.length;
        }
      },
    );
    const now = new Date().toISOString();
    const datedRecords = stampPortalScanRecords(records, now);

    writePortalFacilityCache(datedRecords);

    const latestFacilities = latestUniqueFacilityRecords(datedRecords);
    const facilityTypeCounts = countByFacilityType(datedRecords);
    const statusCounts = summarizeStatus(latestFacilities);
  portalRuntime.scanProgress = {
    completedAt: now,
    portalReportedRecords,
    scannedPages: portalRuntime.scanProgress.scannedPages,
    scannedRecords: datedRecords.length,
    startedAt: portalRuntime.scanProgress.startedAt,
    status: "completed",
  };

    const result = {
      totalFacilities: latestFacilities.length,
      totalPortalRecords: datedRecords.length,
      portalReportedRecords,
      categoryCounts: countByCategory(latestFacilities),
      categoryPortalRecordCounts: countByCategory(datedRecords),
      applicationTypeCounts: countByApplicationType(datedRecords),
      facilityTypeCounts,
      statusCounts,
      scanProgress: portalRuntime.scanProgress,
      lastScanned: now,
      monthlyRegistrationCounts: countByMonth(datedRecords),
      monthlyNewRegistrationCounts: countByMonth(datedRecords, "new_registration"),
      monthlyRenewalCounts: countByMonth(datedRecords, "renewal"),
      yearlyPortalRecordCounts: countByYear(datedRecords),
      yearlyRenewalCounts: countByYear(datedRecords, "renewal"),
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
    return result;
  } catch (error) {
    if (partialRecords.length) {
      writePortalFacilityCache(stampPortalScanRecords(partialRecords));
    }
    throw error;
  } finally {
    await scanPage.close().catch(() => undefined);
    if (primaryPage && !primaryPage.isClosed()) {
      session.page = primaryPage;
      setSession(session);
    }
  }
}

export function startPortalFacilityScan() {
  if (portalRuntime.scanPromise) {
    return getPortalFacilitySummary();
  }

  const startedAt = new Date().toISOString();
  portalRuntime.scanProgress = {
    completedAt: null,
    portalReportedRecords: null,
    scannedPages: 0,
    scannedRecords: 0,
    startedAt,
    status: "running",
  };

  const scanPromise = scanAllPortalFacilities()
    .then(() => undefined)
    .catch((error) => {
      portalRuntime.scanProgress = {
        ...portalRuntime.scanProgress,
        completedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : "Portal scan failed",
        status: "failed",
      };
      console.error("[portal/scan] full scan failed", error);
    })
    .finally(() => {
      if (portalRuntime.scanPromise === scanPromise) portalRuntime.scanPromise = null;
    });
  portalRuntime.scanPromise = scanPromise;

  return getPortalFacilitySummary();
}

export function getPortalFacilityExportRecords() {
  return readPortalFacilityCache();
}

export function searchPortalFacilityCache(input: {
  category?: string;
  limit?: number;
  query?: string;
  status?: string;
  year?: number;
} = {}) {
  const records = readPortalFacilityCache();
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
  const records = classifyPortalFacilityRecords(readPortalFacilityCache());
  const latestFacilities = latestUniqueFacilityRecords(records);
  const lastScanned = records[0]?.lastSeen ?? null;

  return {
    totalFacilities: latestFacilities.length,
    totalPortalRecords: records.length,
    portalReportedRecords: portalRuntime.scanProgress.portalReportedRecords ?? (records.length || null),
    categoryCounts: countByCategory(latestFacilities),
    categoryPortalRecordCounts: countByCategory(records),
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
  };
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
    const { page, storageStatePath } = await openPortalTab({ fastOpen: true });
    return {
      status: "opened",
      url: page.url(),
      requiresManualLogin: true,
      persistentProfile: true,
      browserChannel: browserChannelLabel(currentSession.browserChannel ?? getPortalBrowserChannel()),
      profileName: storageStateName(storageStatePath ?? getPortalStorageStatePath()),
      note: "HEFAMAA portal browser is already active and has been brought to the front.",
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
    profileName: storageStateName(getPortalStorageStatePath()),
    note: "HEFAMAA portal browser launch requested. The dedicated portal window is opening in the background; log in manually if requested. Search and capture will reuse it when ready.",
  };
}

export async function getPortalSessionStatus() {
  let currentSession = getSession();

  if ((!currentSession || currentSession.page.isClosed()) && (await portalDebuggingEndpointReady(getPortalDebuggingPort()))) {
    currentSession = await ensureSession({ fastOpen: true }).catch(() => null);
  }

  const opening = Boolean(portalRuntime.openingSession);
  const active = Boolean(currentSession && !currentSession.page.isClosed());
  const profileDir = currentSession?.profileDir ?? getPortalProfileDir();
  const storageStatePath = currentSession?.storageStatePath ?? getPortalStorageStatePath();
  const lock = getPortalProfileLock(profileDir);

  return {
    status: active ? "active" : opening ? "opening" : "closed",
    url: active ? currentSession?.page.url() : null,
    browserChannel: browserChannelLabel(currentSession?.browserChannel ?? getPortalBrowserChannel()),
    persistentProfile: true,
    profileName: storageStateName(storageStatePath),
    profileLocked: !active && !opening && lock.locked,
    profileLockPid: !active && !opening ? lock.pid : undefined,
    note: active
      ? "Portal browser session is active. Login cookies will be saved to local storage state when you search, capture, or close the portal."
      : opening
        ? "Dedicated portal browser is starting in the background. It will reuse the saved HEFAMAA profile and become available for search and capture shortly."
      : lock.locked
        ? `An old persistent portal profile is still open${lock.pid ? ` in process ${lock.pid}` : ""}, but the current agent now uses storage state instead.`
      : "Portal browser is closed. Opening it will reuse the saved storage state if the portal session is still valid.",
  };
}

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
    await page.waitForTimeout(4_000);
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
    await page.waitForTimeout(4_000);
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
