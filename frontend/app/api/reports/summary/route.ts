import { NextResponse } from "next/server";

export const runtime = "nodejs";

function errorPayload(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown reports summary error";
  return {
    success: false,
    ok: false,
    error: message,
    stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
  };
}

function safeSummary() {
  return {
    source: "safe-fallback",
    totalFacilities: 0,
    totalCategories: 0,
    categories: 0,
    notifications: 0,
    incompleteRecords: 0,
    categorySummary: [],
    lgaSummary: [],
    missingDataSummary: [],
    duplicateSummary: {
      exactDuplicateKeys: 0,
      possibleDuplicateKeys: 0,
    },
    generatedAt: new Date().toISOString(),
    cache: {
      source: "safe-fallback",
      generatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    },
  };
}

export async function GET() {
  console.log("[/api/reports/summary] started");

  try {
    const summary = safeSummary();
    return NextResponse.json({
      success: true,
      ok: true,
      ...summary,
      data: summary,
    });
  } catch (error) {
    console.error("[/api/reports/summary] failed", error);
    return NextResponse.json(errorPayload(error), { status: 500 });
  }
}
