import { NextResponse } from "next/server";

import { lightweightSheetsConfig, readLightweightTabs } from "@/lib/lightweightSheets";

export const runtime = "nodejs";

export async function GET() {
  console.log("[/api/sheets/diagnostics] started");
  const config = lightweightSheetsConfig();

  try {
    if (!config.configured) {
      return NextResponse.json({
        success: false,
        configured: false,
        spreadsheetTitle: "",
        sheetCount: 0,
        tabs: [],
        serviceAccountEmailPresent: config.serviceAccountEmailPresent,
        privateKeyPresent: config.privateKeyPresent,
        error: "Google Sheets configuration is incomplete",
      });
    }

    const { spreadsheetTitle, tabs } = await readLightweightTabs();
    return NextResponse.json({
      success: true,
      configured: true,
      spreadsheetTitle,
      sheetCount: tabs.length,
      tabs,
      serviceAccountEmailPresent: config.serviceAccountEmailPresent,
      privateKeyPresent: config.privateKeyPresent,
    });
  } catch (error) {
    console.error("[/api/sheets/diagnostics] failed", error);
    return NextResponse.json(
      {
        success: false,
        configured: config.configured,
        spreadsheetTitle: "",
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
