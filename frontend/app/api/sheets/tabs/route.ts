import { NextResponse } from "next/server";

import { readLightweightTabs } from "@/lib/lightweightSheets";

export const runtime = "nodejs";

function errorPayload(error: unknown) {
  const message = error instanceof Error ? error.message : "Google Sheets tabs error";
  return {
    success: false,
    ok: false,
    error: message,
    stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
  };
}

export async function GET() {
  console.log("[/api/sheets/tabs] started");

  try {
    const result = await readLightweightTabs();
    return NextResponse.json({
      success: true,
      ok: true,
      data: result.tabs,
      fileName: result.fileName,
      mimeType: result.mimeType,
      readOnly: result.readOnly,
      sourceMode: result.sourceMode,
      spreadsheetTitle: result.spreadsheetTitle,
      tabs: result.tabs,
    });
  } catch (error) {
    console.error("[/api/sheets/tabs] failed", error);
    return NextResponse.json(errorPayload(error), { status: 500 });
  }
}
