import { createRequire } from "node:module";

import { google } from "googleapis";

export type LightweightSourceMode = "google_sheet" | "excel_xlsx";

export type LightweightSheetTab = {
  title: string;
  sheetId: number | null;
  index: number | null;
  rowCount: number;
  headerCount: number;
};

export type LightweightSheet = {
  headers: string[];
  rows: Record<string, string>[];
  sourceMode: LightweightSourceMode;
  title: string;
};

export type LightweightWorkbookSource = {
  fileId: string;
  fileName: string;
  mimeType: string;
  modifiedTime: string | null;
  readOnly: boolean;
  sourceMode: LightweightSourceMode;
  spreadsheetTitle: string;
};

type ParsedExcelSheet = {
  headers: string[];
  rows: Record<string, string>[];
  title: string;
};

type ParsedExcelWorkbook = LightweightWorkbookSource & {
  expiresAt: number;
  sheets: ParsedExcelSheet[];
};

const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const READONLY_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];
const metadataFields = "sheets.properties.title,sheets.properties.sheetId,sheets.properties.index,sheets.properties.gridProperties.rowCount,properties.title";
const nodeRequire = createRequire(import.meta.url);
const globalCache = globalThis as typeof globalThis & {
  __hefaiExcelWorkbookCache?: Record<string, ParsedExcelWorkbook>;
  __hefaiExcelWorkbookInflight?: Record<string, Promise<ParsedExcelWorkbook>>;
};

function excelCacheTtlMs() {
  return 10 * 60 * 1000;
}

function envValue(name: string) {
  return process.env[name]?.trim() || "";
}

export function lightweightSheetsConfig(envName = "GOOGLE_SHEET_ID") {
  const spreadsheetId = parseSpreadsheetId(envValue(envName));
  const serviceAccountEmailPresent = Boolean(envValue("GOOGLE_SERVICE_ACCOUNT_EMAIL"));
  const privateKeyPresent = Boolean(envValue("GOOGLE_PRIVATE_KEY"));
  return {
    configured: Boolean(spreadsheetId && serviceAccountEmailPresent && privateKeyPresent),
    privateKeyPresent,
    serviceAccountEmailPresent,
    spreadsheetId,
  };
}

export function normalizeGooglePrivateKey(value: string) {
  let key = value.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n");
}

export function parseSpreadsheetId(value: string) {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const idMatch = trimmed.match(/([a-zA-Z0-9-_]{20,})/);
  return urlMatch?.[1] ?? idMatch?.[1] ?? trimmed;
}

function requiredEnv(name: string) {
  const value = envValue(name);
  if (!value) throw new Error(name + " is not configured");
  return value;
}

function googleAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      private_key: normalizeGooglePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
    },
    scopes: READONLY_SCOPES,
  });
}

function sheetsClient() {
  return google.sheets({ version: "v4", auth: googleAuth() });
}

function driveClient() {
  return google.drive({ version: "v3", auth: googleAuth() });
}

export function getSpreadsheetId(envName = "GOOGLE_SHEET_ID") {
  return parseSpreadsheetId(requiredEnv(envName));
}

export async function readSpreadsheetFileMetadata(envName = "GOOGLE_SHEET_ID") {
  const fileId = getSpreadsheetId(envName);
  const response = await driveClient().files.get({
    fileId,
    fields: "id,name,mimeType,modifiedTime",
    supportsAllDrives: true,
  });
  const mimeType = response.data.mimeType ?? "";
  const name = response.data.name ?? "";
  console.log("[googleSheets] detected file MIME type", { fileId, mimeType, name });
  return {
    fileId,
    mimeType,
    modifiedTime: response.data.modifiedTime ?? null,
    name,
  };
}

export async function assertNativeGoogleSpreadsheet(envName = "GOOGLE_SHEET_ID") {
  const metadata = await readSpreadsheetFileMetadata(envName);
  if (metadata.mimeType === GOOGLE_SHEETS_MIME_TYPE) return metadata;
  if (metadata.mimeType === XLSX_MIME_TYPE) {
    throw new Error("This operation is read-only in Excel File Mode. Convert the workbook to a native Google Spreadsheet before writing or updating records.");
  }
  throw new Error("The configured file is not a native Google Spreadsheet. Detected MIME type: " + (metadata.mimeType || "unknown"));
}

function quoteSheetName(title: string) {
  return "'" + title.replace(/'/g, "''") + "'";
}

function normalizeCell(value: unknown) {
  if (value === undefined || value === null) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function nonEmptyHeader(headers: string[]) {
  return headers.some((header) => header.trim());
}

function rowsFromMatrix(title: string, matrix: unknown[][], maxRows?: number): ParsedExcelSheet {
  const headerRow = (matrix[0] ?? []).map(normalizeCell);
  const headers = nonEmptyHeader(headerRow) ? headerRow : [];
  const safeLimit = maxRows ? Math.max(1, Math.min(Math.floor(maxRows), 5000)) : Number.POSITIVE_INFINITY;
  const rows = matrix.slice(1, Number.isFinite(safeLimit) ? safeLimit + 1 : undefined).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = normalizeCell(row[index]);
    });
    return record;
  });
  return { headers, rows, title };
}

async function downloadExcelFile(fileId: string) {
  const response = await driveClient().files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return Buffer.from(response.data as ArrayBuffer);
}

async function parseExcelWorkbook(metadata: Awaited<ReturnType<typeof readSpreadsheetFileMetadata>>): Promise<ParsedExcelWorkbook> {
  const cacheKey = metadata.fileId;
  const cached = globalCache.__hefaiExcelWorkbookCache?.[cacheKey];
  if (cached && cached.expiresAt > Date.now() && cached.modifiedTime === metadata.modifiedTime) return cached;

  const inflight = globalCache.__hefaiExcelWorkbookInflight?.[cacheKey];
  if (inflight) return inflight;

  const parsePromise = (async () => {
    const XLSX = nodeRequire("xlsx") as typeof import("xlsx");
    const buffer = await downloadExcelFile(metadata.fileId);
    const workbook = XLSX.read(buffer, { cellDates: true, type: "buffer" });
    const sheets = workbook.SheetNames.map((title) => {
      const worksheet = workbook.Sheets[title];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { blankrows: false, defval: "", header: 1, raw: false });
      return rowsFromMatrix(title, matrix);
    });

    const parsed: ParsedExcelWorkbook = {
      expiresAt: Date.now() + excelCacheTtlMs(),
      fileId: metadata.fileId,
      fileName: metadata.name,
      mimeType: metadata.mimeType,
      modifiedTime: metadata.modifiedTime,
      readOnly: true,
      sheets,
      sourceMode: "excel_xlsx",
      spreadsheetTitle: metadata.name,
    };

    globalCache.__hefaiExcelWorkbookCache = { ...(globalCache.__hefaiExcelWorkbookCache ?? {}), [cacheKey]: parsed };
    return parsed;
  })().finally(() => {
    if (globalCache.__hefaiExcelWorkbookInflight) delete globalCache.__hefaiExcelWorkbookInflight[cacheKey];
  });

  globalCache.__hefaiExcelWorkbookInflight = { ...(globalCache.__hefaiExcelWorkbookInflight ?? {}), [cacheKey]: parsePromise };
  return parsePromise;
}

export async function readWorkbookSource(envName = "GOOGLE_SHEET_ID"): Promise<LightweightWorkbookSource> {
  const metadata = await readSpreadsheetFileMetadata(envName);
  if (metadata.mimeType === GOOGLE_SHEETS_MIME_TYPE) {
    return {
      fileId: metadata.fileId,
      fileName: metadata.name,
      mimeType: metadata.mimeType,
      modifiedTime: metadata.modifiedTime,
      readOnly: false,
      sourceMode: "google_sheet",
      spreadsheetTitle: metadata.name,
    };
  }
  if (metadata.mimeType === XLSX_MIME_TYPE) {
    const workbook = await parseExcelWorkbook(metadata);
    return {
      fileId: workbook.fileId,
      fileName: workbook.fileName,
      mimeType: workbook.mimeType,
      modifiedTime: workbook.modifiedTime,
      readOnly: workbook.readOnly,
      sourceMode: workbook.sourceMode,
      spreadsheetTitle: workbook.spreadsheetTitle,
    };
  }
  throw new Error("The configured file is not a supported workbook. Detected MIME type: " + (metadata.mimeType || "unknown"));
}

export async function readLightweightTabs(envName = "GOOGLE_SHEET_ID") {
  const metadata = await readSpreadsheetFileMetadata(envName);

  if (metadata.mimeType === XLSX_MIME_TYPE) {
    const workbook = await parseExcelWorkbook(metadata);
    const tabs = workbook.sheets.map((sheet, index) => ({
      title: sheet.title,
      sheetId: null,
      index,
      rowCount: nonEmptyRows(sheet.rows).length,
      headerCount: sheet.headers.filter(Boolean).length,
    } satisfies LightweightSheetTab));
    return {
      fileName: workbook.fileName,
      mimeType: workbook.mimeType,
      readOnly: true,
      sourceMode: workbook.sourceMode,
      spreadsheetTitle: workbook.spreadsheetTitle,
      tabs,
    };
  }

  if (metadata.mimeType !== GOOGLE_SHEETS_MIME_TYPE) {
    throw new Error("The configured file is not a supported workbook. Detected MIME type: " + (metadata.mimeType || "unknown"));
  }

  const response = await sheetsClient().spreadsheets.get({
    spreadsheetId: metadata.fileId,
    fields: metadataFields,
  });
  const tabs = (response.data.sheets ?? []).map((sheet) => ({
    title: sheet.properties?.title ?? "",
    sheetId: sheet.properties?.sheetId ?? null,
    index: sheet.properties?.index ?? null,
    rowCount: Math.max(0, Number(sheet.properties?.gridProperties?.rowCount ?? 0) - 1),
    headerCount: 0,
  } satisfies LightweightSheetTab));
  return {
    fileName: metadata.name,
    mimeType: metadata.mimeType,
    readOnly: false,
    sourceMode: "google_sheet" as const,
    spreadsheetTitle: response.data.properties?.title ?? metadata.name,
    tabs,
  };
}

export async function readLimitedSheet(title: string, maxRows: number, envName = "GOOGLE_SHEET_ID"): Promise<LightweightSheet> {
  const metadata = await readSpreadsheetFileMetadata(envName);
  const safeMaxRows = Math.max(1, Math.min(Math.floor(maxRows), 5000));

  if (metadata.mimeType === XLSX_MIME_TYPE) {
    const workbook = await parseExcelWorkbook(metadata);
    const sheet = workbook.sheets.find((item) => item.title === title);
    if (!sheet) return { headers: [], rows: [], sourceMode: "excel_xlsx", title };
    return {
      headers: sheet.headers,
      rows: sheet.rows.slice(0, safeMaxRows),
      sourceMode: "excel_xlsx",
      title: sheet.title,
    };
  }

  if (metadata.mimeType !== GOOGLE_SHEETS_MIME_TYPE) {
    throw new Error("The configured file is not a supported workbook. Detected MIME type: " + (metadata.mimeType || "unknown"));
  }

  const range = quoteSheetName(title) + "!A1:ZZ" + (safeMaxRows + 1);
  const response = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: metadata.fileId,
    range,
    majorDimension: "ROWS",
  });
  const values = response.data.values ?? [];
  const headers = (values[0] ?? []).map((value) => String(value ?? "").trim());
  const rows = values.slice(1).map((row) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = row[index];
      record[header] = value === undefined || value === null ? "" : String(value).trim();
    });
    return record;
  });
  return { headers, rows, sourceMode: "google_sheet", title };
}

export async function readLimitedWorkbook(maxRows: number, envName = "GOOGLE_SHEET_ID") {
  const tabsResult = await readLightweightTabs(envName);
  const safeMaxRows = Math.max(1, Math.min(Math.floor(maxRows), 5000));

  if (tabsResult.sourceMode === "excel_xlsx") {
    const metadata = await readSpreadsheetFileMetadata(envName);
    const workbook = await parseExcelWorkbook(metadata);
    return {
      fileName: workbook.fileName,
      mimeType: workbook.mimeType,
      readOnly: true,
      sheets: workbook.sheets.map((sheet) => ({
        headers: sheet.headers,
        rows: sheet.rows.slice(0, safeMaxRows),
        sourceMode: "excel_xlsx" as const,
        title: sheet.title,
      })),
      sourceMode: "excel_xlsx" as const,
      spreadsheetTitle: workbook.spreadsheetTitle,
      tabs: tabsResult.tabs,
    };
  }

  const sheets = await Promise.all(
    tabsResult.tabs
      .filter((tab) => tab.title)
      .map((tab) => readLimitedSheet(tab.title, safeMaxRows, envName)),
  );

  return {
    fileName: tabsResult.fileName,
    mimeType: tabsResult.mimeType,
    readOnly: tabsResult.readOnly,
    sheets,
    sourceMode: tabsResult.sourceMode,
    spreadsheetTitle: tabsResult.spreadsheetTitle,
    tabs: tabsResult.tabs,
  };
}

export function nonEmptyRows(rows: Record<string, string>[]) {
  return rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
}
