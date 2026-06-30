import { NextResponse } from "next/server";

import { lightweightSheetsConfig, readLightweightTabs, readSpreadsheetFileMetadata } from "@/lib/lightweightSheets";

export const runtime = "nodejs";

const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const xlsxError = "The configured file is an Excel (.xlsx) file. Please convert it to a Google Spreadsheet.";

export async function GET() {
  console.log("[/api/sheets/diagnostics] started");
  const config = lightweightSheetsConfig();
  let fileId = config.spreadsheetId || "";
  let mimeType = "";
  let spreadsheetTitle = "";
  let isGoogleSpreadsheet = false;
  let canReadSheets = false;

  try {
    if (!config.configured) {
      return NextResponse.json({
        success: false,
        configured: false,
        fileId,
        mimeType,
        spreadsheetTitle,
        isGoogleSpreadsheet,
        canReadSheets,
        sheetCount: 0,
        tabs: [],
        serviceAccountEmailPresent: config.serviceAccountEmailPresent,
        privateKeyPresent: config.privateKeyPresent,
        error: "Google Sheets configuration is incomplete",
      });
    }

    const metadata = await readSpreadsheetFileMetadata();
    fileId = metadata.fileId;
    mimeType = metadata.mimeType;
    spreadsheetTitle = metadata.name;
    isGoogleSpreadsheet = mimeType === GOOGLE_SHEETS_MIME_TYPE;

    if (mimeType === XLSX_MIME_TYPE) {
      return NextResponse.json(
        {
          success: false,
          configured: true,
          fileId,
          mimeType,
          spreadsheetTitle,
          isGoogleSpreadsheet: false,
          canReadSheets: false,
          sheetCount: 0,
          tabs: [],
          serviceAccountEmailPresent: config.serviceAccountEmailPresent,
          privateKeyPresent: config.privateKeyPresent,
          error: xlsxError,
        },
        { status: 400 },
      );
    }

    if (!isGoogleSpreadsheet) {
      return NextResponse.json(
        {
          success: false,
          configured: true,
          fileId,
          mimeType,
          spreadsheetTitle,
          isGoogleSpreadsheet: false,
          canReadSheets: false,
          sheetCount: 0,
          tabs: [],
          serviceAccountEmailPresent: config.serviceAccountEmailPresent,
          privateKeyPresent: config.privateKeyPresent,
          error: "The configured file is not a native Google Spreadsheet. Detected MIME type: " + (mimeType || "unknown"),
        },
        { status: 400 },
      );
    }

    const tabsResult = await readLightweightTabs();
    spreadsheetTitle = tabsResult.spreadsheetTitle || spreadsheetTitle;
    canReadSheets = true;
    return NextResponse.json({
      success: true,
      configured: true,
      fileId,
      mimeType,
      spreadsheetTitle,
      isGoogleSpreadsheet,
      canReadSheets,
      sheetCount: tabsResult.tabs.length,
      tabs: tabsResult.tabs,
      serviceAccountEmailPresent: config.serviceAccountEmailPresent,
      privateKeyPresent: config.privateKeyPresent,
    });
  } catch (error) {
    console.error("[/api/sheets/diagnostics] failed", error);
    return NextResponse.json(
      {
        success: false,
        configured: config.configured,
        fileId,
        mimeType,
        spreadsheetTitle,
        isGoogleSpreadsheet,
        canReadSheets,
        sheetCount: 0,
        tabs: [],
        serviceAccountEmailPresent: config.serviceAccountEmailPresent,
        privateKeyPresent: config.privateKeyPresent,
        error: error instanceof Error ? error.message : "Google Sheets diagnostics failed",
        stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
