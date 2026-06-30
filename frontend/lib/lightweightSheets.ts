import { google } from "googleapis";

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
  title: string;
};

const READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly";
const metadataFields = "sheets.properties.title,sheets.properties.sheetId,sheets.properties.index,sheets.properties.gridProperties.rowCount,properties.title";

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

function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL"),
      private_key: normalizeGooglePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY")),
    },
    scopes: [READONLY_SCOPE],
  });
  return google.sheets({ version: "v4", auth });
}

export function getSpreadsheetId(envName = "GOOGLE_SHEET_ID") {
  return parseSpreadsheetId(requiredEnv(envName));
}

function quoteSheetName(title: string) {
  return "'" + title.replace(/'/g, "''") + "'";
}

export async function readLightweightTabs(envName = "GOOGLE_SHEET_ID") {
  const response = await sheetsClient().spreadsheets.get({
    spreadsheetId: getSpreadsheetId(envName),
    fields: metadataFields,
  });
  const tabs = (response.data.sheets ?? []).map((sheet) => ({
    title: sheet.properties?.title ?? "",
    sheetId: sheet.properties?.sheetId ?? null,
    index: sheet.properties?.index ?? null,
    rowCount: Math.max(0, Number(sheet.properties?.gridProperties?.rowCount ?? 0) - 1),
    headerCount: 0,
  } satisfies LightweightSheetTab));
  return { spreadsheetTitle: response.data.properties?.title ?? "", tabs };
}

export async function readLimitedSheet(title: string, maxRows: number, envName = "GOOGLE_SHEET_ID"): Promise<LightweightSheet> {
  const safeMaxRows = Math.max(1, Math.min(Math.floor(maxRows), 5000));
  const range = quoteSheetName(title) + "!A1:ZZ" + (safeMaxRows + 1);
  const response = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: getSpreadsheetId(envName),
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
  return { headers, rows, title };
}

export function nonEmptyRows(rows: Record<string, string>[]) {
  return rows.filter((row) => Object.values(row).some((value) => String(value ?? "").trim()));
}
