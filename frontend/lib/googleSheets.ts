import { AsyncLocalStorage } from "node:async_hooks";
import { Readable } from "node:stream";

import ExcelJS from "exceljs";
import { google, type drive_v3, type sheets_v4 } from "googleapis";

import { checkDuplicateFacility } from "@/lib/duplicateChecker";
import { normalizeHeaderName, normalizePhoneNumber } from "@/lib/normalizers";
import type {
  CreateSheetInput,
  SheetHeaderResult,
  SheetRow,
  SheetRowValue,
  SheetRowsResult,
  SheetTab,
} from "@/types/sheet";

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];
const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DEFAULT_SHEET_CACHE_TTL_MS = 60_000;

type CacheEntry<T> = {
  fileId: string;
  expiresAt: number;
  value: T;
};

type AllSheetData = Record<
  string,
  {
    headers: string[];
    rows: SheetRow[];
  }
>;

type SpreadsheetDocument =
  | {
      kind: "native";
      name: string;
      modifiedTime?: string | null;
    }
  | {
      kind: "xlsx";
      name: string;
      modifiedTime?: string | null;
    };

type SheetHeaderCell = {
  header: string;
  columnIndex: number;
};

type OfficeWorkbookCache = {
  fileId: string;
  modifiedTime?: string | null;
  workbook: ExcelJS.Workbook;
};

type GoogleSheetsRuntimeCache = {
  sheetsClient: sheets_v4.Sheets | null;
  driveClient: drive_v3.Drive | null;
  officeWorkbook: OfficeWorkbookCache | null;
  spreadsheetDocument: CacheEntry<SpreadsheetDocument> | null;
  sheetTabs: CacheEntry<SheetTab[]> | null;
  allSheetData: CacheEntry<AllSheetData> | null;
  sheetHeaders: Map<string, CacheEntry<SheetHeaderResult>>;
  sheetRows: Map<string, CacheEntry<SheetRowsResult>>;
};

const globalCache = globalThis as typeof globalThis & {
  __hefamaaGoogleSheetsRuntimeCache?: GoogleSheetsRuntimeCache;
};

const runtimeCache =
  globalCache.__hefamaaGoogleSheetsRuntimeCache ??
  (globalCache.__hefamaaGoogleSheetsRuntimeCache = {
    sheetsClient: null,
    driveClient: null,
    officeWorkbook: null,
    spreadsheetDocument: null,
    sheetTabs: null,
    allSheetData: null,
    sheetHeaders: new Map<string, CacheEntry<SheetHeaderResult>>(),
    sheetRows: new Map<string, CacheEntry<SheetRowsResult>>(),
  });

const GOOGLE_SHEETS_ENV_KEYS = ["GOOGLE_SHEET_ID", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "GOOGLE_PRIVATE_KEY"] as const;

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`${name} is not configured`);
  }

  return value;
}

function normalizeGooglePrivateKey(rawKey: string) {
  let key = rawKey.trim();

  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1);
  }

  return key.replace(/\\n/g, "\n");
}

function getPrivateKey() {
  return normalizeGooglePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"));
}

export function getGoogleSheetsConfigStatus() {
  const missing = GOOGLE_SHEETS_ENV_KEYS.filter((name) => !process.env[name]?.trim());
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();
  const normalizedPrivateKey = privateKey ? normalizeGooglePrivateKey(privateKey) : "";
  const privateKeyLooksValid = Boolean(
    normalizedPrivateKey.includes("-----BEGIN PRIVATE KEY-----") &&
      normalizedPrivateKey.includes("-----END PRIVATE KEY-----"),
  );

  return {
    missing,
    privateKeyLooksValid,
    ready: missing.length === 0 && privateKeyLooksValid,
  };
}

export function assertGoogleSheetsConfigured() {
  const status = getGoogleSheetsConfigStatus();
  if (!status.ready) {
    console.error("[googleSheets] Google Sheets configuration missing or invalid", {
      missing: status.missing,
      privateKeyLooksValid: status.privateKeyLooksValid,
    });
    throw new Error("Google Sheets configuration missing or invalid");
  }

  return status;
}

const spreadsheetIdContext = new AsyncLocalStorage<string>();

function parseSpreadsheetId(rawValue: string) {
  const value = rawValue.trim().replace(/^["']|["']$/g, "");
  const urlMatch = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const idMatch = value.match(/([a-zA-Z0-9-_]{20,})/);

  return urlMatch?.[1] ?? idMatch?.[1] ?? value;
}

function getSpreadsheetId() {
  return spreadsheetIdContext.getStore() ?? parseSpreadsheetId(requiredEnv("GOOGLE_SHEET_ID"));
}

export function getConfiguredSpreadsheetId(envName: string) {
  const rawValue = process.env[envName]?.trim();
  return rawValue ? parseSpreadsheetId(rawValue) : null;
}

export function withSpreadsheetId<T>(spreadsheetId: string, operation: () => Promise<T>) {
  return spreadsheetIdContext.run(parseSpreadsheetId(spreadsheetId), operation);
}

function createGoogleAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      private_key: getPrivateKey(),
    },
    scopes: GOOGLE_SCOPES,
  });
}

function getSheetsClient() {
  if (!runtimeCache.sheetsClient) {
    runtimeCache.sheetsClient = google.sheets({ version: "v4", auth: createGoogleAuth() });
  }

  return runtimeCache.sheetsClient;
}

function getDriveClient() {
  if (!runtimeCache.driveClient) {
    runtimeCache.driveClient = google.drive({ version: "v3", auth: createGoogleAuth() });
  }

  return runtimeCache.driveClient;
}

function normalizeCategory(category: string) {
  return category.trim().toUpperCase();
}

function sheetCacheTtlMs() {
  const value = Number(process.env.SHEET_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_SHEET_CACHE_TTL_MS;
}

function cacheKey(category: string) {
  return normalizeCategory(category);
}

function readCache<T>(entry: CacheEntry<T> | null | undefined) {
  if (!entry || sheetCacheTtlMs() === 0) {
    return null;
  }

  if (entry.fileId !== getSpreadsheetId() || entry.expiresAt <= Date.now()) {
    return null;
  }

  return entry.value;
}

function createCacheEntry<T>(value: T): CacheEntry<T> | null {
  const ttlMs = sheetCacheTtlMs();

  if (ttlMs === 0) {
    return null;
  }

  return {
    fileId: getSpreadsheetId(),
    expiresAt: Date.now() + ttlMs,
    value,
  };
}

function cloneRow(row: SheetRow): SheetRow {
  return { ...row };
}

function cloneRows(rows: SheetRow[]) {
  return rows.map(cloneRow);
}

function cloneTabs(tabs: SheetTab[]) {
  return tabs.map((tab) => ({ ...tab }));
}

function cloneHeaderResult(result: SheetHeaderResult): SheetHeaderResult {
  return {
    category: result.category,
    headers: [...result.headers],
  };
}

function cloneRowsResult(result: SheetRowsResult): SheetRowsResult {
  return {
    category: result.category,
    headers: [...result.headers],
    rows: cloneRows(result.rows),
  };
}

function cloneAllSheetData(data: AllSheetData): AllSheetData {
  return Object.fromEntries(
    Object.entries(data).map(([category, sheet]) => [
      category,
      {
        headers: [...sheet.headers],
        rows: cloneRows(sheet.rows),
      },
    ]),
  );
}

function writeCache<T>(assign: (entry: CacheEntry<T>) => void, value: T) {
  const entry = createCacheEntry(value);

  if (entry) {
    assign(entry);
  }
}

function cacheSheetRows(result: SheetRowsResult) {
  const entry = createCacheEntry(cloneRowsResult(result));

  if (entry) {
    runtimeCache.sheetRows.set(cacheKey(result.category), entry);
  }
}

function cacheSheetHeaders(result: SheetHeaderResult) {
  const entry = createCacheEntry(cloneHeaderResult(result));

  if (entry) {
    runtimeCache.sheetHeaders.set(cacheKey(result.category), entry);
  }
}

function cacheAllSheetData(data: AllSheetData) {
  writeCache((entry) => {
    runtimeCache.allSheetData = entry;
  }, cloneAllSheetData(data));

  const tabs = Object.entries(data).map(([title, sheet]) => ({
    title,
    rowCount: sheet.rows.length,
    headerCount: sheet.headers.length,
  }));

  writeCache((entry) => {
    runtimeCache.sheetTabs = entry;
  }, tabs);
}

export function clearSheetDataCache() {
  runtimeCache.officeWorkbook = null;
  runtimeCache.spreadsheetDocument = null;
  runtimeCache.sheetTabs = null;
  runtimeCache.allSheetData = null;
  runtimeCache.sheetHeaders.clear();
  runtimeCache.sheetRows.clear();
}

function releaseOfficeWorkbookCache() {
  runtimeCache.officeWorkbook = null;
}

export function getSheetCacheStatus() {
  const now = Date.now();

  return {
    ttlMs: sheetCacheTtlMs(),
    documentCached: Boolean(readCache(runtimeCache.spreadsheetDocument)),
    tabsCached: Boolean(readCache(runtimeCache.sheetTabs)),
    allDataCached: Boolean(readCache(runtimeCache.allSheetData)),
    cachedHeaderCategories: [...runtimeCache.sheetHeaders.entries()]
      .filter(([, entry]) => entry.expiresAt > now && entry.fileId === getSpreadsheetId())
      .map(([category]) => category),
    cachedRowCategories: [...runtimeCache.sheetRows.entries()]
      .filter(([, entry]) => entry.expiresAt > now && entry.fileId === getSpreadsheetId())
      .map(([category]) => category),
  };
}

function quoteSheetName(title: string) {
  return `'${title.replace(/'/g, "''")}'`;
}

function columnName(index: number) {
  let current = index;
  let result = "";

  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }

  return result;
}

function looksLikeSecret(value: string) {
  return (
    /^AIza[0-9A-Za-z_-]{20,}$/.test(value) ||
    /^sk-[0-9A-Za-z_-]{20,}$/.test(value) ||
    /private[_-]?key|api[_-]?key|secret/i.test(value)
  );
}

function sanitizeHeaderName(header: string, columnIndex: number) {
  if (!looksLikeSecret(header)) {
    return header;
  }

  return columnIndex === 1 ? "S/NO" : "";
}

function toSheetRowValue(value: unknown): SheetRowValue {
  if (typeof value === "string" || typeof value === "number") {
    return value === "" ? null : value;
  }

  if (typeof value === "boolean") {
    return value ? "TRUE" : "FALSE";
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (value == null) {
    return null;
  }

  return String(value);
}

function excelCellValueToSheetValue(value: ExcelJS.CellValue): SheetRowValue {
  if (value == null) {
    return null;
  }

  if (typeof value !== "object" || value instanceof Date) {
    return toSheetRowValue(value);
  }

  const objectValue = value as {
    text?: string;
    hyperlink?: string;
    richText?: Array<{ text?: string }>;
    result?: unknown;
    formula?: string;
  };

  if (Array.isArray(objectValue.richText)) {
    return toSheetRowValue(objectValue.richText.map((part) => part.text ?? "").join(""));
  }

  if (objectValue.text) {
    return toSheetRowValue(objectValue.text);
  }

  if (objectValue.result != null) {
    return toSheetRowValue(objectValue.result);
  }

  if (objectValue.formula) {
    return toSheetRowValue(objectValue.formula);
  }

  if (objectValue.hyperlink) {
    return toSheetRowValue(objectValue.hyperlink);
  }

  return toSheetRowValue(value);
}

function toWritableCellValue(value: SheetRowValue) {
  return value ?? "";
}

function isContactHeader(header: string) {
  const normalized = normalizeHeaderName(header);
  return (
    normalized === "contact" ||
    normalized.includes("phone") ||
    normalized.includes("telephone") ||
    normalized.includes("mobile")
  );
}

function valueForHeader(header: string, value: SheetRowValue) {
  if (!isContactHeader(header)) {
    return value;
  }

  const rawValue = String(value ?? "").trim();

  if (!rawValue || /[a-z,;/]/i.test(rawValue)) {
    return value;
  }

  const normalizedPhone = normalizePhoneNumber(rawValue);
  return normalizedPhone || value;
}

const SERIAL_HEADER_KEYS = new Set(["sn", "sno", "serialno", "serialnumber", "snumber", "number"]);
const NON_SERIAL_FIRST_COLUMN_KEYS = new Set(["hefno", "hefanumber", "facilitycode", "facilityid", "facilityname", "name", "address", "lga", "lcda"]);

function compactHeaderName(header: string) {
  return normalizeHeaderName(header).replace(/[^a-z0-9]+/g, "");
}

function serialHeaderFor(headers: string[]) {
  const explicitSerialHeader = headers.find((header) => SERIAL_HEADER_KEYS.has(compactHeaderName(header)));

  if (explicitSerialHeader) {
    return explicitSerialHeader;
  }

  const firstHeader = headers[0];
  const hasFacilityIdentityColumns = headers.some((header) => /hef|facility code/i.test(header)) && headers.some((header) => /facility name|name of facility/i.test(header));
  const firstHeaderKey = firstHeader ? compactHeaderName(firstHeader) : "";

  // Some imported HEFAMAA Excel sheets have a malformed first header, for example
  // "niger", where the column is still the serial-number column. When the sheet
  // also has HEF/NO and Facility Name columns, the first column should be treated
  // as the serial column unless it is clearly a real data field.
  if (firstHeader && hasFacilityIdentityColumns && !NON_SERIAL_FIRST_COLUMN_KEYS.has(firstHeaderKey)) {
    return firstHeader;
  }

  return null;
}

function isFilledCell(value: SheetRowValue | undefined) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function rowHasDataOutsideSerial(row: SheetRow, serialHeader: string) {
  return Object.entries(row).some(([header, value]) => header !== serialHeader && isFilledCell(value));
}

function numericSerialValue(value: SheetRowValue | undefined) {
  if (!isFilledCell(value)) return null;
  const match = String(value).trim().match(/^\d+$/);
  return match ? Number(match[0]) : null;
}

function nextSerialNumber(existingRows: SheetRow[], serialHeader: string) {
  const serialValues = existingRows
    .map((existingRow) => numericSerialValue(existingRow[serialHeader]))
    .filter((value): value is number => Number.isFinite(value));

  if (serialValues.length > 0) {
    return Math.max(...serialValues) + 1;
  }

  return existingRows.filter((existingRow) => rowHasDataOutsideSerial(existingRow, serialHeader)).length + 1;
}

function applyAutoSerialNumber(headers: string[], row: SheetRow, existingRows: SheetRow[]) {
  const serialHeader = serialHeaderFor(headers);

  if (!serialHeader || isFilledCell(row[serialHeader]) || !rowHasDataOutsideSerial(row, serialHeader)) {
    return { row, autoSerial: null };
  }

  const nextSerial = nextSerialNumber(existingRows, serialHeader);

  return {
    row: {
      ...row,
      [serialHeader]: nextSerial,
    },
    autoSerial: {
      header: serialHeader,
      value: nextSerial,
    },
  };
}

function rowFromHeaderCells(headerCells: SheetHeaderCell[], values: unknown[] = []) {
  const row: SheetRow = {};

  headerCells.forEach(({ header, columnIndex }) => {
    row[header] = valueForHeader(header, toSheetRowValue(values[columnIndex - 1]));
  });

  return row;
}

function coerceRowToHeaders(headers: string[], values: SheetRow) {
  const row: SheetRow = {};
  const allowed = new Set(headers);
  const serialHeader = serialHeaderFor(headers);

  for (const header of headers) {
    row[header] = values[header] ?? null;
  }

  for (const key of Object.keys(values)) {
    if (allowed.has(key)) {
      continue;
    }

    const value = values[key];
    const isEmptyUnknownField = !isFilledCell(value);
    const isIncomingSerialAlias = Boolean(serialHeader && SERIAL_HEADER_KEYS.has(compactHeaderName(key)));

    if (isEmptyUnknownField || isIncomingSerialAlias) {
      continue;
    }

    throw new Error(`Field "${key}" is not part of the selected sheet headers`);
  }

  return row;
}

async function withGoogleApiError<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    throw normalizeGoogleApiError(error);
  }
}

function normalizeGoogleApiError(error: unknown) {
  const googleError = error as {
    code?: number;
    message?: string;
    response?: { status?: number; data?: { error?: { message?: string } } };
  };
  const status = googleError.code ?? googleError.response?.status;
  const message =
    googleError.response?.data?.error?.message ??
    googleError.message ??
    (error instanceof Error ? error.message : "Google API request failed");

  if (status === 404 || /requested entity was not found/i.test(message)) {
    return new Error(
      "Google file was not found. Check GOOGLE_SHEET_ID and share the file with GOOGLE_SERVICE_ACCOUNT_EMAIL as Editor.",
    );
  }

  if (status === 403) {
    return new Error(
      "Google Drive or Sheets access was denied. Share the file with GOOGLE_SERVICE_ACCOUNT_EMAIL as Editor and confirm the Google Drive and Google Sheets APIs are enabled for the service account project.",
    );
  }

  return error instanceof Error ? error : new Error(message);
}

async function getDriveFileMetadata() {
  const response = await withGoogleApiError(() =>
    getDriveClient().files.get({
      fileId: getSpreadsheetId(),
      fields: "id,name,mimeType,modifiedTime",
      supportsAllDrives: true,
    }),
  );

  return response.data;
}

async function getSpreadsheetDocument(): Promise<SpreadsheetDocument> {
  const cached = readCache(runtimeCache.spreadsheetDocument);

  if (cached) {
    return cached;
  }

  const metadata = await getDriveFileMetadata();
  const name = metadata.name ?? "HEFAMAA database";
  const mimeType = metadata.mimeType ?? "";
  let document: SpreadsheetDocument;

  if (mimeType === GOOGLE_SHEETS_MIME_TYPE) {
    document = { kind: "native", name, modifiedTime: metadata.modifiedTime };
  } else if (mimeType === XLSX_MIME_TYPE || name.toLowerCase().endsWith(".xlsx")) {
    document = { kind: "xlsx", name, modifiedTime: metadata.modifiedTime };
  } else {
    throw new Error(
      `Unsupported database file type "${mimeType || name}". Use a native Google Sheet or an .xlsx workbook.`,
    );
  }

  writeCache((entry) => {
    runtimeCache.spreadsheetDocument = entry;
  }, document);

  return document;
}

async function getNativeSpreadsheetMetadata() {
  const response = await withGoogleApiError(() =>
    getSheetsClient().spreadsheets.get({
      spreadsheetId: getSpreadsheetId(),
      fields: "sheets(properties(title,gridProperties(rowCount,columnCount)))",
    }),
  );

  return response.data.sheets ?? [];
}

async function resolveNativeSheetTitle(category: string) {
  const normalized = normalizeCategory(category);
  const sheets = await getNativeSpreadsheetMetadata();
  const match = sheets.find((sheet) => {
    const title = sheet.properties?.title;
    return title ? normalizeCategory(title) === normalized : false;
  });

  const title = match?.properties?.title;

  if (!title) {
    throw new Error(`Sheet category "${normalized}" does not exist`);
  }

  return title;
}

async function readNativeValues(range: string) {
  const response = await withGoogleApiError(() =>
    getSheetsClient().spreadsheets.values.get({
      spreadsheetId: getSpreadsheetId(),
      range,
    }),
  );

  return response.data.values ?? [];
}

async function readNativeSheetSchema(category: string) {
  const sheetTitle = await resolveNativeSheetTitle(category);
  const values = await readNativeValues(`${quoteSheetName(sheetTitle)}!1:1`);
  const headerCells = (values[0] ?? []).reduce<SheetHeaderCell[]>((cells, value, index) => {
    const columnIndex = index + 1;
    const header = sanitizeHeaderName(String(value ?? "").trim(), columnIndex);

    if (header) {
      cells.push({ header, columnIndex });
    }

    return cells;
  }, []);
  const headers = headerCells.map(({ header }) => header);

  if (!headers.length) {
    throw new Error(`Sheet category "${sheetTitle}" has no headers in row 1`);
  }

  return { sheetTitle, headers, headerCells };
}

function parseUpdatedDataRowIndex(updatedRange?: string | null) {
  if (!updatedRange) {
    return null;
  }

  const match = updatedRange.match(/![A-Z]+(\d+)/);
  if (!match) {
    return null;
  }

  return Math.max(0, Number(match[1]) - 2);
}

async function downloadOfficeWorkbook(document?: SpreadsheetDocument) {
  const fileId = getSpreadsheetId();
  const modifiedTime = document?.modifiedTime;

  if (
    runtimeCache.officeWorkbook &&
    runtimeCache.officeWorkbook.fileId === fileId &&
    runtimeCache.officeWorkbook.modifiedTime === modifiedTime
  ) {
    return runtimeCache.officeWorkbook.workbook;
  }

  const response = await withGoogleApiError(() =>
    getDriveClient().files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      {
        responseType: "arraybuffer",
      },
    ),
  );

  const data = response.data as ArrayBuffer | Buffer;
  const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const workbook = new ExcelJS.Workbook();

  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  runtimeCache.officeWorkbook = {
    fileId,
    modifiedTime,
    workbook,
  };

  return workbook;
}

async function uploadOfficeWorkbook(workbook: ExcelJS.Workbook) {
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

  await withGoogleApiError(() =>
    getDriveClient().files.update({
      fileId: getSpreadsheetId(),
      media: {
        mimeType: XLSX_MIME_TYPE,
        body: Readable.from(buffer),
      },
      supportsAllDrives: true,
    }),
  );
  releaseOfficeWorkbookCache();
}

function getOfficeWorksheet(workbook: ExcelJS.Workbook, category: string) {
  const normalized = normalizeCategory(category);
  const worksheet = workbook.worksheets.find((sheet) => normalizeCategory(sheet.name) === normalized);

  if (!worksheet) {
    throw new Error(`Sheet category "${normalized}" does not exist`);
  }

  return worksheet;
}

function readOfficeHeaderCells(worksheet: ExcelJS.Worksheet) {
  const firstRow = worksheet.getRow(1);
  const headerCells: SheetHeaderCell[] = [];

  for (let columnIndex = 1; columnIndex <= worksheet.columnCount; columnIndex += 1) {
    const header = sanitizeHeaderName(
      String(excelCellValueToSheetValue(firstRow.getCell(columnIndex).value) ?? "").trim(),
      columnIndex,
    );

    if (header) {
      headerCells.push({ header, columnIndex });
    }
  }

  if (!headerCells.length) {
    throw new Error(`Sheet category "${worksheet.name}" has no headers in row 1`);
  }

  return headerCells;
}

function readOfficeHeaders(worksheet: ExcelJS.Worksheet) {
  return readOfficeHeaderCells(worksheet).map(({ header }) => header);
}

function tryReadOfficeHeaderCells(worksheet: ExcelJS.Worksheet) {
  try {
    return readOfficeHeaderCells(worksheet);
  } catch (error) {
    if (error instanceof Error && /has no headers in row 1/i.test(error.message)) {
      return [];
    }

    throw error;
  }
}

function officeRowHasFacilityData(worksheetRow: ExcelJS.Row, headerCells: SheetHeaderCell[]) {
  return headerCells.some(({ header, columnIndex }) => {
    const normalizedHeader = normalizeHeaderName(header);
    const value = excelCellValueToSheetValue(worksheetRow.getCell(columnIndex).value);

    if (!isFilledCell(value)) {
      return false;
    }

    // Serial-only rows are not facility records. A valid occupied row must have
    // at least one non-serial field such as facility name, HEF/NO, address, etc.
    return !SERIAL_HEADER_KEYS.has(compactHeaderName(normalizedHeader));
  });
}

function lastOfficeFacilityRowNumber(worksheet: ExcelJS.Worksheet, headerCells: SheetHeaderCell[]) {
  const scanLimit = Math.max(worksheet.rowCount, worksheet.actualRowCount, 1);

  for (let rowNumber = scanLimit; rowNumber >= 2; rowNumber -= 1) {
    if (officeRowHasFacilityData(worksheet.getRow(rowNumber), headerCells)) {
      return rowNumber;
    }
  }

  return 1;
}

function nextOfficeAppendRowNumber(worksheet: ExcelJS.Worksheet, headerCells: SheetHeaderCell[]) {
  return Math.max(2, lastOfficeFacilityRowNumber(worksheet, headerCells) + 1);
}

function readOfficeRows(worksheet: ExcelJS.Worksheet, headerCells: SheetHeaderCell[]) {
  const rows: SheetRow[] = [];
  const lastRowNumber = lastOfficeFacilityRowNumber(worksheet, headerCells);

  for (let rowNumber = 2; rowNumber <= lastRowNumber; rowNumber += 1) {
    const worksheetRow = worksheet.getRow(rowNumber);
    const row: SheetRow = {};

    headerCells.forEach(({ header, columnIndex }) => {
      row[header] = valueForHeader(header, excelCellValueToSheetValue(worksheetRow.getCell(columnIndex).value));
    });

    if (officeRowHasFacilityData(worksheetRow, headerCells)) {
      rows.push(row);
    }
  }

  return rows;
}

async function readNativeSheetTabs(): Promise<SheetTab[]> {
  const sheets = await getNativeSpreadsheetMetadata();

  return sheets.map((sheet) => {
    const title = sheet.properties?.title ?? "";
    const rowCount = Math.max(0, Number(sheet.properties?.gridProperties?.rowCount ?? 0) - 1);

    return {
      title,
      rowCount,
      headerCount: 0,
    };
  });
}

async function readOfficeSheetTabs(document: SpreadsheetDocument): Promise<SheetTab[]> {
  const workbook = await downloadOfficeWorkbook(document);

  const tabs = workbook.worksheets.map((worksheet) => ({
    title: worksheet.name,
    rowCount: Math.max(0, (worksheet.actualRowCount || worksheet.rowCount) - 1),
    headerCount: tryReadOfficeHeaderCells(worksheet).length,
  }));

  releaseOfficeWorkbookCache();

  return tabs;
}

async function readSheetTabsUncached(): Promise<SheetTab[]> {
  const document = await getSpreadsheetDocument();

  if (document.kind === "xlsx") {
    return [
      {
        title: document.name,
        rowCount: 0,
        headerCount: 0,
      },
    ];
  }

  return readNativeSheetTabs();
}

export async function readSheetTabs(): Promise<SheetTab[]> {
  const cached = readCache(runtimeCache.sheetTabs);

  if (cached) {
    return cloneTabs(cached);
  }

  const tabs = await readSheetTabsUncached();

  writeCache((entry) => {
    runtimeCache.sheetTabs = entry;
  }, cloneTabs(tabs));

  return cloneTabs(tabs);
}

async function readSheetHeadersUncached(category: string): Promise<SheetHeaderResult> {
  const document = await getSpreadsheetDocument();

  if (document.kind === "xlsx") {
    const workbook = await downloadOfficeWorkbook(document);
    const worksheet = getOfficeWorksheet(workbook, category);
    const result = { category: worksheet.name, headers: readOfficeHeaders(worksheet) };

    releaseOfficeWorkbookCache();

    return result;
  }

  const { sheetTitle, headers } = await readNativeSheetSchema(category);
  return { category: sheetTitle, headers };
}

export async function readSheetHeaders(category: string) {
  const cached = readCache(runtimeCache.sheetHeaders.get(cacheKey(category)));

  if (cached) {
    return cloneHeaderResult(cached);
  }

  const allSheetData = readCache(runtimeCache.allSheetData);
  const cachedSheetEntry = Object.entries(allSheetData ?? {}).find(
    ([sheetCategory]) => cacheKey(sheetCategory) === cacheKey(category),
  );

  if (cachedSheetEntry) {
    const [sheetCategory, sheet] = cachedSheetEntry;

    return {
      category: sheetCategory,
      headers: [...sheet.headers],
    };
  }

  const result = await readSheetHeadersUncached(category);
  cacheSheetHeaders(result);

  return cloneHeaderResult(result);
}

async function readExistingRecordsUncached(category: string): Promise<SheetRowsResult> {
  const document = await getSpreadsheetDocument();

  if (document.kind === "xlsx") {
    const workbook = await downloadOfficeWorkbook(document);
    const worksheet = getOfficeWorksheet(workbook, category);
    const headerCells = readOfficeHeaderCells(worksheet);
    const headers = headerCells.map(({ header }) => header);
    const result = {
      category: worksheet.name,
      headers,
      rows: readOfficeRows(worksheet, headerCells),
    };

    releaseOfficeWorkbookCache();

    return result;
  }

  const { sheetTitle, headers, headerCells } = await readNativeSheetSchema(category);
  const lastColumnIndex = Math.max(...headerCells.map(({ columnIndex }) => columnIndex));
  const lastColumn = columnName(lastColumnIndex);
  const values = await readNativeValues(`${quoteSheetName(sheetTitle)}!A2:${lastColumn}`);

  return {
    category: sheetTitle,
    headers,
    rows: values.map((row) => rowFromHeaderCells(headerCells, row)),
  };
}

export async function readExistingRecords(category: string): Promise<SheetRowsResult> {
  const cached = readCache(runtimeCache.sheetRows.get(cacheKey(category)));

  if (cached) {
    return cloneRowsResult(cached);
  }

  const allSheetData = readCache(runtimeCache.allSheetData);
  const sheetEntry = Object.entries(allSheetData ?? {}).find(
    ([sheetCategory]) => cacheKey(sheetCategory) === cacheKey(category),
  );

  if (sheetEntry) {
    const [sheetCategory, sheet] = sheetEntry;

    return {
      category: sheetCategory,
      headers: [...sheet.headers],
      rows: cloneRows(sheet.rows),
    };
  }

  const result = await readExistingRecordsUncached(category);
  cacheSheetHeaders({ category: result.category, headers: result.headers });
  cacheSheetRows(result);

  return cloneRowsResult(result);
}

export type PreparedFacilityRow = {
  category: string;
  headers: string[];
  row: SheetRow;
  autoSerial: {
    header: string;
    value: number;
  } | null;
};

export async function prepareNewFacilityRow(category: string, values: SheetRow): Promise<PreparedFacilityRow> {
  const existingRecords = await readExistingRecordsUncached(category);
  const baseRow = coerceRowToHeaders(existingRecords.headers, values);
  const prepared = applyAutoSerialNumber(existingRecords.headers, baseRow, existingRecords.rows);

  return {
    category: existingRecords.category,
    headers: existingRecords.headers,
    row: prepared.row,
    autoSerial: prepared.autoSerial,
  };
}

export async function addPreparedFacilityRow(prepared: PreparedFacilityRow) {
  const document = await getSpreadsheetDocument();

  if (document.kind === "xlsx") {
    const workbook = await downloadOfficeWorkbook(document);
    const worksheet = getOfficeWorksheet(workbook, prepared.category);
    const headerCells = readOfficeHeaderCells(worksheet);
    const nextRowNumber = nextOfficeAppendRowNumber(worksheet, headerCells);
    const worksheetRow = worksheet.getRow(nextRowNumber);

    for (const { header, columnIndex } of headerCells) {
      worksheetRow.getCell(columnIndex).value = toWritableCellValue(prepared.row[header]);
    }

    worksheetRow.commit();
    await uploadOfficeWorkbook(workbook);
    clearSheetDataCache();

    return {
      category: worksheet.name,
      rowIndex: Math.max(0, nextRowNumber - 2),
      row: prepared.row,
      autoSerial: prepared.autoSerial,
    };
  }

  const { sheetTitle, headerCells } = await readNativeSheetSchema(prepared.category);
  const lastColumnIndex = Math.max(...headerCells.map(({ columnIndex }) => columnIndex));
  const lastColumn = columnName(lastColumnIndex);
  const writableRow: SheetRowValue[] = Array.from({ length: lastColumnIndex }, () => "");

  for (const { header, columnIndex } of headerCells) {
    writableRow[columnIndex - 1] = toWritableCellValue(prepared.row[header]);
  }

  const response = await withGoogleApiError(() =>
    getSheetsClient().spreadsheets.values.append({
      spreadsheetId: getSpreadsheetId(),
      range: `${quoteSheetName(sheetTitle)}!A:${lastColumn}`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [writableRow],
      },
    }),
  );

  const parsedRowIndex = parseUpdatedDataRowIndex(response.data.updates?.updatedRange);
  clearSheetDataCache();

  return {
    category: sheetTitle,
    rowIndex: parsedRowIndex ?? 0,
    row: prepared.row,
    autoSerial: prepared.autoSerial,
  };
}

export async function addNewFacilityRow(category: string, values: SheetRow) {
  return addPreparedFacilityRow(await prepareNewFacilityRow(category, values));
}

export async function appendFacilityRowFast(category: string, values: SheetRow, options: { saveAnyway?: boolean } = {}) {
  const document = await getSpreadsheetDocument();

  if (document.kind === "xlsx") {
    const workbook = await downloadOfficeWorkbook(document);
    const worksheet = getOfficeWorksheet(workbook, category);
    const headerCells = readOfficeHeaderCells(worksheet);
    const headers = headerCells.map(({ header }) => header);
    const existingRows = readOfficeRows(worksheet, headerCells);
    const baseRow = coerceRowToHeaders(headers, values);
    const prepared = applyAutoSerialNumber(headers, baseRow, existingRows);

    if (!options.saveAnyway) {
      const duplicate = checkDuplicateFacility(prepared.row, existingRows);

      if (duplicate.status !== "no_duplicate") {
        const bestMatch = duplicate.matches[0];
        releaseOfficeWorkbookCache();
        return {
          duplicateBlocked: true,
          category: worksheet.name,
          status: duplicate.status,
          matches: duplicate.matches,
          rowIndex: bestMatch?.rowIndex ?? 0,
          row: bestMatch?.row ?? prepared.row,
          autoSerial: prepared.autoSerial,
          message: "Duplicate facility detected. Review the existing row before choosing Save Anyway.",
        };
      }
    }

    const nextRowNumber = nextOfficeAppendRowNumber(worksheet, headerCells);
    const worksheetRow = worksheet.getRow(nextRowNumber);

    for (const { header, columnIndex } of headerCells) {
      worksheetRow.getCell(columnIndex).value = toWritableCellValue(prepared.row[header]);
    }

    worksheetRow.commit();
    await uploadOfficeWorkbook(workbook);
    clearSheetDataCache();

    return {
      category: worksheet.name,
      rowIndex: Math.max(0, nextRowNumber - 2),
      row: prepared.row,
      autoSerial: prepared.autoSerial,
    };
  }

  const prepared = await prepareNewFacilityRow(category, values);

  if (!options.saveAnyway) {
    clearSheetDataCache();
    const existing = await readExistingRecords(prepared.category);
    const duplicate = checkDuplicateFacility(prepared.row, existing.rows);

    if (duplicate.status !== "no_duplicate") {
      const bestMatch = duplicate.matches[0];
      return {
        duplicateBlocked: true,
        category: prepared.category,
        status: duplicate.status,
        matches: duplicate.matches,
        rowIndex: bestMatch?.rowIndex ?? 0,
        row: bestMatch?.row ?? prepared.row,
        autoSerial: prepared.autoSerial,
        message: "Duplicate facility detected. Review the existing row before choosing Save Anyway.",
      };
    }
  }

  return addPreparedFacilityRow(prepared);
}

export async function updateExistingFacilityRow(
  category: string,
  rowIndex: number,
  values: SheetRow,
  confirmedFields?: string[],
) {
  const document = await getSpreadsheetDocument();

  if (document.kind === "xlsx") {
    const workbook = await downloadOfficeWorkbook(document);
    const worksheet = getOfficeWorksheet(workbook, category);
    const headerCells = readOfficeHeaderCells(worksheet);
    const headers = headerCells.map(({ header }) => header);
    const columnIndexByHeader = new Map(headerCells.map(({ header, columnIndex }) => [header, columnIndex]));
    const headerSet = new Set(headers);
    const fieldsToUpdate = confirmedFields?.length ? confirmedFields : Object.keys(values);
    const worksheetRow = worksheet.getRow(rowIndex + 2);

    for (const field of fieldsToUpdate) {
      if (!headerSet.has(field)) {
        throw new Error(`Field "${field}" is not part of the selected sheet headers`);
      }

      worksheetRow.getCell(columnIndexByHeader.get(field) ?? 1).value = toWritableCellValue(values[field] ?? null);
    }

    worksheetRow.commit();
    await uploadOfficeWorkbook(workbook);
    clearSheetDataCache();

    return {
      category: worksheet.name,
      rowIndex,
      row: Object.fromEntries(
        headerCells.map(({ header, columnIndex }) => [
          header,
          valueForHeader(header, excelCellValueToSheetValue(worksheetRow.getCell(columnIndex).value)),
        ]),
      ) as SheetRow,
    };
  }

  const { sheetTitle, headers, headerCells } = await readNativeSheetSchema(category);
  const headerSet = new Set(headers);
  const columnIndexByHeader = new Map(headerCells.map(({ header, columnIndex }) => [header, columnIndex]));
  const fieldsToUpdate = confirmedFields?.length ? confirmedFields : Object.keys(values);

  for (const field of fieldsToUpdate) {
    if (!headerSet.has(field)) {
      throw new Error(`Field "${field}" is not part of the selected sheet headers`);
    }
  }

  const sheetRowNumber = rowIndex + 2;
  const lastColumnIndex = Math.max(...headerCells.map(({ columnIndex }) => columnIndex));
  const lastColumn = columnName(lastColumnIndex);
  const existingValues = await readNativeValues(
    `${quoteSheetName(sheetTitle)}!A${sheetRowNumber}:${lastColumn}${sheetRowNumber}`,
  );
  const nextValues = Array.from(
    { length: lastColumnIndex },
    (_, index) => existingValues[0]?.[index] ?? "",
  );

  for (const field of fieldsToUpdate) {
    const columnIndex = columnIndexByHeader.get(field);

    if (columnIndex) {
      nextValues[columnIndex - 1] = toWritableCellValue(values[field] ?? null);
    }
  }

  await withGoogleApiError(() =>
    getSheetsClient().spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `${quoteSheetName(sheetTitle)}!A${sheetRowNumber}:${lastColumn}${sheetRowNumber}`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [nextValues],
      },
    }),
  );
  clearSheetDataCache();

  return {
    category: sheetTitle,
    rowIndex,
    row: rowFromHeaderCells(headerCells, nextValues),
  };
}

export type SheetCellUpdate = {
  category: string;
  rowIndex: number;
  field: string;
  value: SheetRowValue;
};

export type SheetCellUpdateResult = {
  updatedCells: number;
  categories: Array<{
    category: string;
    updatedCells: number;
  }>;
};

function groupCellUpdatesByCategory(updates: SheetCellUpdate[]) {
  const grouped = new Map<string, SheetCellUpdate[]>();

  for (const update of updates) {
    if (update.rowIndex < 0) {
      throw new Error("Row index cannot be negative");
    }

    const key = cacheKey(update.category);
    const entries = grouped.get(key) ?? [];
    entries.push(update);
    grouped.set(key, entries);
  }

  return grouped;
}

export async function updateSheetCells(updates: SheetCellUpdate[]): Promise<SheetCellUpdateResult> {
  if (!updates.length) {
    return { updatedCells: 0, categories: [] };
  }

  const document = await getSpreadsheetDocument();
  const groupedUpdates = groupCellUpdatesByCategory(updates);
  const categoryResults: SheetCellUpdateResult["categories"] = [];

  if (document.kind === "xlsx") {
    const workbook = await downloadOfficeWorkbook(document);

    for (const categoryUpdates of groupedUpdates.values()) {
      const worksheet = getOfficeWorksheet(workbook, categoryUpdates[0].category);
      const headerCells = readOfficeHeaderCells(worksheet);
      const columnIndexByHeader = new Map(headerCells.map(({ header, columnIndex }) => [header, columnIndex]));
      let updatedCells = 0;

      for (const update of categoryUpdates) {
        const columnIndex = columnIndexByHeader.get(update.field);

        if (!columnIndex) {
          throw new Error('Field "' + update.field + '" is not part of the selected sheet headers');
        }

        const worksheetRow = worksheet.getRow(update.rowIndex + 2);
        worksheetRow.getCell(columnIndex).value = toWritableCellValue(update.value);
        worksheetRow.commit();
        updatedCells += 1;
      }

      categoryResults.push({ category: worksheet.name, updatedCells });
    }

    await uploadOfficeWorkbook(workbook);
    clearSheetDataCache();

    return {
      updatedCells: categoryResults.reduce((total, item) => total + item.updatedCells, 0),
      categories: categoryResults,
    };
  }

  const data: sheets_v4.Schema$ValueRange[] = [];

  for (const categoryUpdates of groupedUpdates.values()) {
    const { sheetTitle, headerCells } = await readNativeSheetSchema(categoryUpdates[0].category);
    const columnIndexByHeader = new Map(headerCells.map(({ header, columnIndex }) => [header, columnIndex]));
    let updatedCells = 0;

    for (const update of categoryUpdates) {
      const columnIndex = columnIndexByHeader.get(update.field);

      if (!columnIndex) {
        throw new Error('Field "' + update.field + '" is not part of the selected sheet headers');
      }

      const column = columnName(columnIndex);
      const sheetRowNumber = update.rowIndex + 2;
      data.push({
        range: quoteSheetName(sheetTitle) + "!" + column + sheetRowNumber,
        values: [[toWritableCellValue(update.value)]],
      });
      updatedCells += 1;
    }

    categoryResults.push({ category: sheetTitle, updatedCells });
  }

  await withGoogleApiError(() =>
    getSheetsClient().spreadsheets.values.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data,
      },
    }),
  );
  clearSheetDataCache();

  return {
    updatedCells: categoryResults.reduce((total, item) => total + item.updatedCells, 0),
    categories: categoryResults,
  };
}

export async function createNewCategorySheet(input: CreateSheetInput) {
  const document = await getSpreadsheetDocument();
  const category = normalizeCategory(input.category);

  if (document.kind === "xlsx") {
    const workbook = await downloadOfficeWorkbook(document);
    const exists = workbook.worksheets.some((worksheet) => normalizeCategory(worksheet.name) === category);

    if (exists) {
      throw new Error(`Sheet category "${category}" already exists`);
    }

    const worksheet = workbook.addWorksheet(category);
    worksheet.addRow(input.headers);

    await uploadOfficeWorkbook(workbook);
    clearSheetDataCache();

    return {
      category: worksheet.name,
      headers: [...input.headers],
    };
  }

  const sheets = await getNativeSpreadsheetMetadata();
  const exists = sheets.some((sheet) => {
    const title = sheet.properties?.title;
    return title ? normalizeCategory(title) === category : false;
  });

  if (exists) {
    throw new Error(`Sheet category "${category}" already exists`);
  }

  await withGoogleApiError(() =>
    getSheetsClient().spreadsheets.batchUpdate({
      spreadsheetId: getSpreadsheetId(),
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: category,
              },
            },
          },
        ],
      },
    }),
  );

  const lastColumn = columnName(input.headers.length);
  await withGoogleApiError(() =>
    getSheetsClient().spreadsheets.values.update({
      spreadsheetId: getSpreadsheetId(),
      range: `${quoteSheetName(category)}!A1:${lastColumn}1`,
      valueInputOption: "RAW",
      requestBody: {
        values: [input.headers],
      },
    }),
  );
  clearSheetDataCache();

  return {
    category,
    headers: [...input.headers],
  };
}

async function getAllSheetDataUncached(): Promise<AllSheetData> {
  const document = await getSpreadsheetDocument();

  if (document.kind === "xlsx") {
    const workbook = await downloadOfficeWorkbook(document);

    const data = Object.fromEntries(
      workbook.worksheets.flatMap((worksheet) => {
        const headerCells = tryReadOfficeHeaderCells(worksheet);

        if (!headerCells.length) {
          return [];
        }

        return [
          [
            worksheet.name,
            {
              headers: headerCells.map(({ header }) => header),
              rows: readOfficeRows(worksheet, headerCells),
            },
          ] as const,
        ];
      }),
    );

    releaseOfficeWorkbookCache();

    return data;
  }

  const tabs = await readSheetTabs();
  const entries = await Promise.all(
    tabs
      .filter((tab) => tab.headerCount > 0)
      .map(async (tab) => {
        const data = await readExistingRecords(tab.title);
        return [
          tab.title,
          {
            headers: data.headers,
            rows: data.rows,
          },
        ] as const;
      }),
  );

  return Object.fromEntries(entries);
}

export async function getAllSheetData() {
  const cached = readCache(runtimeCache.allSheetData);

  if (cached) {
    return cached;
  }

  const data = await getAllSheetDataUncached();
  cacheAllSheetData(data);

  return data;
}
