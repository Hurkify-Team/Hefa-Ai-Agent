import { google } from "googleapis";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

const metadataFields = "sheets.properties.title,sheets.properties.sheetId,sheets.properties.index,properties.title";

function errorPayload(error: unknown) {
  const message = error instanceof Error ? error.message : "Google Sheets tabs error";
  return {
    success: false,
    ok: false,
    error: message,
    stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
  };
}

function normalizePrivateKey(value: string) {
  let key = value.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  return key.replace(/\\n/g, "\n");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + " is not configured");
  return value;
}

function parseSpreadsheetId(value: string) {
  const trimmed = value.trim().replace(/^["']|["']$/g, "");
  const urlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const idMatch = trimmed.match(/([a-zA-Z0-9-_]{20,})/);
  return urlMatch?.[1] ?? idMatch?.[1] ?? trimmed;
}

async function readTabMetadata() {
  const spreadsheetId = parseSpreadsheetId(requiredEnv("GOOGLE_SHEET_ID"));
  const clientEmail = requiredEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
  const privateKey = normalizePrivateKey(requiredEnv("GOOGLE_PRIVATE_KEY"));

  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: clientEmail,
      private_key: privateKey,
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  const sheets = google.sheets({ version: "v4", auth });
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: metadataFields,
  });

  return (response.data.sheets ?? []).map((sheet) => ({
    title: sheet.properties?.title ?? "",
    sheetId: sheet.properties?.sheetId ?? null,
    index: sheet.properties?.index ?? null,
    rowCount: 0,
    headerCount: 0,
  }));
}

export async function GET() {
  console.log("[/api/sheets/tabs] started");

  try {
    const tabs = await readTabMetadata();
    return NextResponse.json({
      success: true,
      ok: true,
      data: tabs,
      tabs,
    });
  } catch (error) {
    console.error("[/api/sheets/tabs] failed", error);
    return NextResponse.json(errorPayload(error), { status: 500 });
  }
}
