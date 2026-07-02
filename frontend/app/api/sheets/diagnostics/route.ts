import { NextResponse } from "next/server";

import { lightweightSheetsConfig, readLightweightTabs, readSpreadsheetFileMetadata } from "@/lib/lightweightSheets";

export const runtime = "nodejs";

const GOOGLE_SHEETS_MIME_TYPE = "application/vnd.google-apps.spreadsheet";
const XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function GET() {
  console.log("[/api/sheets/diagnostics] started");
  const config = lightweightSheetsConfig();
  let fileId = config.spreadsheetId || "";
  let mimeType = "";
  let spreadsheetTitle = "";
  let isGoogleSpreadsheet = false;
  let canReadSheets = false;
  let sourceMode: "google_sheet" | "excel_xlsx" | "unsupported" = "unsupported";
  let readOnly = true;

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
        sourceMode,
        readOnly,
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
    sourceMode = mimeType === XLSX_MIME_TYPE ? "excel_xlsx" : isGoogleSpreadsheet ? "google_sheet" : "unsupported";
    readOnly = sourceMode !== "google_sheet";

    if (!isGoogleSpreadsheet && mimeType !== XLSX_MIME_TYPE) {
      return NextResponse.json(
        {
          success: false,
          configured: true,
          fileId,
          mimeType,
          spreadsheetTitle,
          isGoogleSpreadsheet: false,
          canReadSheets: false,
          sourceMode,
          readOnly,
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
      sourceMode: tabsResult.sourceMode,
      readOnly: tabsResult.readOnly,
      fileName: tabsResult.fileName,
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
        sourceMode,
        readOnly,
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
