import { lookup } from "node:dns/promises";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { Browser, BrowserContext, Page } from "playwright";

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
  renewalYear: number | null;
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
  | "upload_payment_pending_document_approval"
  | "payment_approved_pending_document_approval"
  | "document_approved_inspection_pending"
  | "inspection_report_upload_pending_approval"
  | "final_approval_pending"
  | "unknown_status";

type PortalFacilityRecord = FacilitySearchResultRow & {
  normalizedStatus: PortalFacilityStatus;
  recordDate?: string | null;
  lastSeen: string;
};

type PortalFacilitySummary = {
  totalFacilities: number;
  statusCounts: Record<PortalFacilityStatus, number>;
  lastScanned: string | null;
  monthlyRegistrationCounts: Array<{ month: string; count: number }>;
  yearlyRenewalCounts: Array<{ year: number; count: number }>;
  note?: string;
};

type PortalRuntimeStore = {
  cleanupHooksAttached: boolean;
  hostResolveCheckedAt: number;
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
    session: null,
  });

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
  await withTimeout(
    (async () => {
      await persistPortalStorageState(session);
      await session.context.close().catch(() => undefined);
      await session.browser?.close().catch(() => undefined);
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
  mkdirSync(profileDir, { recursive: true });
  mkdirSync(path.dirname(storageStatePath), { recursive: true });

  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      ...(browserChannel ? { channel: browserChannel } : {}),
      chromiumSandbox: true,
      headless: false,
      timeout: 12_000,
      args: [
        "--start-maximized",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-infobars",
        "--disable-popup-blocking",
        "--disable-blink-features=AutomationControlled",
      ],
    });

    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: null,
      ...(existsSync(storageStatePath) ? { storageState: storageStatePath } : {}),
    });

    return { browser, browserChannel, context, storageStatePath };
  } catch (error) {
    await browser?.close().catch(() => undefined);
    const message = error instanceof Error ? error.message : "";

    if (/Timeout|Timed out/i.test(message)) {
      throw new Error(
        `Timed out opening the HEFAMAA portal browser with ${browserChannelLabel(browserChannel)}. Try again, or close extra Chrome windows if macOS is busy.`,
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

        return {
          index,
          facilityName,
          hefamaaId,
          category,
          registrationStatus,
          renewalYear,
          recordDate,
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

  if (value.includes("document") && value.includes("query")) {
    return "document_queried";
  }

  if ((value.includes("upload") && value.includes("payment")) || value.includes("pending document")) {
    return "upload_payment_pending_document_approval";
  }

  if ((value.includes("payment approved") || value.includes("paid")) && value.includes("pending document")) {
    return "payment_approved_pending_document_approval";
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

  if (value.includes("approved")) {
    return "payment_approved_pending_document_approval";
  }

  return "unknown_status";
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
    upload_payment_pending_document_approval: 0,
    payment_approved_pending_document_approval: 0,
    document_approved_inspection_pending: 0,
    inspection_report_upload_pending_approval: 0,
    final_approval_pending: 0,
    unknown_status: 0,
  });
}

function countByMonth(records: PortalFacilityRecord[]) {
  const counts: Record<string, number> = {};

  for (const record of records) {
    const date = parseDateString(record.recordDate);
    if (!date) continue;

    const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    counts[month] = (counts[month] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));
}

function countByYear(records: PortalFacilityRecord[]) {
  const counts: Record<number, number> = {};

  for (const record of records) {
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

async function clickNextFacilityPage(page: Page) {
  const nextButtons = page.locator(
    [
      'button[aria-label*="next" i]',
      'a[aria-label*="next" i]',
      'button:has-text("Next")',
      'a:has-text("Next")',
      'button:has-text("»")',
      'a:has-text("»")',
      '[role="button"]:has-text("Next")',
    ].join(", "),
  );
  const count = await nextButtons.count();

  for (let index = 0; index < count; index += 1) {
    const button = nextButtons.nth(index);
    const disabled = await button.getAttribute("disabled");
    const ariaDisabled = await button.getAttribute("aria-disabled");
    const hidden = !(await button.isVisible().catch(() => false));

    if (!hidden && !disabled && ariaDisabled !== "true") {
      await button.click().catch(() => undefined);
      return true;
    }
  }

  return false;
}

async function scanFacilityList(page: Page, maxPages = 100) {
  if (!page.url().startsWith(getFacilitiesUrl())) {
    await page.goto(getFacilitiesUrl(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(800);
  const gathered: PortalFacilityRecord[] = [];

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const currentRows = await getFacilityResultRows(page);
    const currentRecords = currentRows.map((row) => ({
      ...row,
      normalizedStatus: normalizePortalStatus(row.registrationStatus, row.renewalYear),
      lastSeen: new Date().toISOString(),
    }));

    gathered.push(...currentRecords);

    const hasNext = await clickNextFacilityPage(page);
    if (!hasNext) {
      break;
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 }).catch(() => undefined);
    await page.waitForTimeout(1_000);
  }

  return dedupeFacilityRecords(gathered);
}

export async function scanAllPortalFacilities() {
  const session = await getActiveSession();
  const { page } = session;
  const records = await scanFacilityList(page);
  const now = new Date().toISOString();

  const datedRecords = records.map((record) => ({
    ...record,
    lastSeen: now,
  }));

  writePortalFacilityCache(datedRecords);

  return {
    totalFacilities: datedRecords.length,
    statusCounts: summarizeStatus(datedRecords),
    lastScanned: now,
    monthlyRegistrationCounts: countByMonth(datedRecords),
    yearlyRenewalCounts: countByYear(datedRecords),
    note: datedRecords.length === 0 ? "No facility rows were found during portal scan." : undefined,
  };
}

export async function getPortalFacilitySummary() {
  const records = readPortalFacilityCache();
  const lastScanned = records[0]?.lastSeen ?? null;

  return {
    totalFacilities: records.length,
    statusCounts: summarizeStatus(records),
    lastScanned,
    monthlyRegistrationCounts: countByMonth(records),
    yearlyRenewalCounts: countByYear(records),
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
  const startedAt = Date.now();
  const { page, storageStatePath } = await openPortalTab({ fastOpen: true });

  return {
    status: "opened",
    url: page.url(),
    requiresManualLogin: true,
    persistentProfile: true,
    browserChannel: browserChannelLabel(getSession()?.browserChannel ?? getPortalBrowserChannel()),
    profileName: storageStateName(storageStatePath ?? getPortalStorageStatePath()),
    note: "Portal browser requested in " + ((Date.now() - startedAt) / 1000).toFixed(1) + "s. Log in manually if HEFAMAA asks; the agent will reuse that session until the portal expires it.",
  };
}

export async function getPortalSessionStatus() {
  const currentSession = getSession();
  const active = Boolean(currentSession && !currentSession.page.isClosed());
  const profileDir = currentSession?.profileDir ?? getPortalProfileDir();
  const storageStatePath = currentSession?.storageStatePath ?? getPortalStorageStatePath();
  const lock = getPortalProfileLock(profileDir);

  return {
    status: active ? "active" : "closed",
    url: active ? currentSession?.page.url() : null,
    browserChannel: browserChannelLabel(currentSession?.browserChannel ?? getPortalBrowserChannel()),
    persistentProfile: true,
    profileName: storageStateName(storageStatePath),
    profileLocked: lock.locked,
    profileLockPid: lock.pid,
    note: active
      ? "Portal browser session is active. Login cookies will be saved to local storage state when you search, capture, or close the portal."
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
