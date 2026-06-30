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
    const { tabs } = await readLightweightTabs();
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
