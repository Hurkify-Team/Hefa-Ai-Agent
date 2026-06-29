import { NextResponse } from "next/server";

import { assertGoogleSheetsConfigured, readSheetTabs } from "@/lib/googleSheets";

export const runtime = "nodejs";

function jsonError(error: unknown, status = 500) {
  const message = error instanceof Error ? error.message : "Google Sheets configuration missing or invalid";
  return NextResponse.json(
    {
      ok: false,
      success: false,
      error: message || "Google Sheets configuration missing or invalid",
    },
    { status },
  );
}

export async function GET() {
  console.info("[/api/sheets/tabs] Dashboard sheet tabs request started");

  try {
    assertGoogleSheetsConfigured();
    const tabs = await readSheetTabs();
    console.info("[/api/sheets/tabs] Dashboard sheet tabs request completed", { tabs: tabs.length });
    return NextResponse.json({ ok: true, success: true, data: tabs });
  } catch (error) {
    console.error("[/api/sheets/tabs] Google Sheets connection failed", error);
    return jsonError(error, 500);
  }
}
