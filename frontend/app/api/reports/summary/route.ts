import { NextResponse } from "next/server";

import { nonEmptyRows, readLimitedWorkbook } from "@/lib/lightweightSheets";

export const runtime = "nodejs";

type SummaryCache = {
  expiresAt: number;
  payload: Record<string, unknown>;
};

const globalCache = globalThis as typeof globalThis & { __hefaiDashboardSummaryCache?: SummaryCache };

function maxRows() {
  const value = Number(process.env.DASHBOARD_SUMMARY_MAX_ROWS ?? 500);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 5000) : 500;
}

function ttlMs() {
  const value = Number(process.env.DASHBOARD_CACHE_TTL_SECONDS ?? 600);
  return (Number.isFinite(value) && value > 0 ? value : 600) * 1000;
}

function errorPayload(error: unknown) {
  const message = error instanceof Error ? error.message : "Unknown reports summary error";
  return {
    success: false,
    ok: false,
    error: message,
    stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
  };
}

function valueFor(row: Record<string, string>, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const direct = row[name];
    if (direct && direct.trim()) return direct.trim();
    const normalized = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    const match = entries.find(([key]) => key.toLowerCase().replace(/[^a-z0-9]+/g, "") === normalized);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function isIncomplete(row: Record<string, string>) {
  const important = [
    ["Facility Name", "FACILITY NAME", "Name"],
    ["Address", "ADDRESS"],
    ["LGA", "Local Government"],
    ["Contact", "Phone", "Phone Number"],
  ];
  return important.some((fields) => !valueFor(row, fields));
}

export async function GET() {
  console.log("[/api/reports/summary] started");

  try {
    const cached = globalCache.__hefaiDashboardSummaryCache;
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ success: true, ok: true, ...cached.payload, data: cached.payload });
    }

    const generatedAt = new Date().toISOString();
    const rowLimit = maxRows();
    const workbook = await readLimitedWorkbook(rowLimit);
    const tabs = workbook.tabs;
    let totalFacilities = 0;
    let incompleteRecords = 0;
    const lgaCounts = new Map<string, number>();
    const categorySummary: Array<{ category: string; rows: number; headers: number }> = [];
    const missingDataSummary: Array<{ category: string; missingRecords: number }> = [];

    for (const tab of tabs) {
      if (!tab.title) continue;
      const sheet = workbook.sheets.find((item) => item.title === tab.title);
      if (!sheet) continue;
      const rows = nonEmptyRows(sheet.rows);
      const missing = rows.filter(isIncomplete).length;
      totalFacilities += rows.length;
      incompleteRecords += missing;
      categorySummary.push({ category: tab.title, rows: rows.length, headers: sheet.headers.filter(Boolean).length });
      missingDataSummary.push({ category: tab.title, missingRecords: missing });
      for (const row of rows) {
        const lga = valueFor(row, ["LGA", "Local Government"]);
        if (lga) lgaCounts.set(lga, (lgaCounts.get(lga) ?? 0) + 1);
      }
    }

    const payload = {
      source: workbook.sourceMode === "excel_xlsx" ? "excel-xlsx-limited" : "google-sheets-limited",
      sourceMode: workbook.sourceMode,
      dataSourceLabel: workbook.sourceMode === "excel_xlsx" ? "Excel File Mode" : "Google Sheet Mode",
      fileName: workbook.fileName,
      mimeType: workbook.mimeType,
      readOnly: workbook.readOnly,
      generatedAt,
      rowLimit,
      totalFacilities,
      totalCategories: tabs.length,
      categories: tabs.length,
      notifications: 0,
      incompleteRecords,
      categorySummary: categorySummary.sort((a, b) => b.rows - a.rows),
      lgaSummary: [...lgaCounts.entries()].map(([lga, count]) => ({ lga, count })).sort((a, b) => b.count - a.count).slice(0, 20),
      missingDataSummary,
      duplicateSummary: {
        exactDuplicateKeys: 0,
        possibleDuplicateKeys: 0,
      },
      cache: {
        source: workbook.sourceMode === "excel_xlsx" ? "excel-xlsx-limited" : "google-sheets-limited",
        generatedAt,
        expiresAt: new Date(Date.now() + ttlMs()).toISOString(),
      },
    };

    globalCache.__hefaiDashboardSummaryCache = { expiresAt: Date.now() + ttlMs(), payload };
    return NextResponse.json({ success: true, ok: true, ...payload, data: payload });
  } catch (error) {
    console.error("[/api/reports/summary] failed", error);
    return NextResponse.json(errorPayload(error), { status: 500 });
  }
}
