import { NextResponse } from "next/server";

import { nonEmptyRows, readLightweightTabs, readLimitedSheet } from "@/lib/lightweightSheets";

export const runtime = "nodejs";

type SourceConfig = {
  envName: "GOOGLE_SHEET_ID" | "OLD_GOOGLE_SHEET_ID";
  label: string;
  source: "active" | "old";
};

const sources: SourceConfig[] = [
  { envName: "GOOGLE_SHEET_ID", label: "Hefamaa Active Database", source: "active" },
  { envName: "OLD_GOOGLE_SHEET_ID", label: "Old Hefamaa Database", source: "old" },
];

function maxRows() {
  const value = Number(process.env.DASHBOARD_SUMMARY_MAX_ROWS ?? 500);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 5000) : 500;
}

function maxCategories() {
  const value = Number(process.env.FACILITY_SEARCH_MAX_CATEGORIES ?? 8);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 25) : 8;
}

function errorPayload(error: unknown) {
  const message = error instanceof Error ? error.message : "Facility search failed";
  return {
    success: false,
    ok: false,
    error: message,
    stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
  };
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function valueFor(row: Record<string, string>, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const direct = row[name];
    if (direct && direct.trim()) return direct.trim();
    const match = entries.find(([key]) => compact(key) === compact(name));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

function rowText(row: Record<string, string>, category: string) {
  return normalize([category, ...Object.entries(row).flatMap(([key, value]) => [key, value])].join(" "));
}

function tabCandidates(tabs: Array<{ title: string }>, category: string | undefined, query: string) {
  if (category) return tabs.filter((tab) => compact(tab.title) === compact(category)).map((tab) => tab.title);
  const queryText = normalize(query);
  const ranked = tabs
    .map((tab) => {
      const title = normalize(tab.title);
      const score = title && queryText.includes(title) ? 100 : title.split(" ").filter((token) => token && queryText.includes(token)).length;
      return { score, title: tab.title };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return ranked.slice(0, maxCategories()).map((entry) => entry.title);
}

async function searchSource(source: SourceConfig, query: string, category: string | undefined, limit: number) {
  if (source.envName === "OLD_GOOGLE_SHEET_ID" && !process.env.OLD_GOOGLE_SHEET_ID?.trim()) return [];
  const { tabs } = await readLightweightTabs(source.envName);
  const categories = tabCandidates(tabs, category, query);
  const results: Array<Record<string, unknown>> = [];
  const normalizedQuery = normalize(query);

  for (const sheetTitle of categories) {
    const sheet = await readLimitedSheet(sheetTitle, maxRows(), source.envName);
    const rows = nonEmptyRows(sheet.rows);
    rows.forEach((row, rowIndex) => {
      if (!rowText(row, sheet.title).includes(normalizedQuery)) return;
      const facilityName = valueFor(row, ["Facility Name", "FACILITY NAME", "Name", "Name of Facility"]);
      const hefNo = valueFor(row, ["HEF/NO", "HEF NO", "HEFAMAA NO", "Facility Code", "FACILITY CODE", "Registration Number"]);
      results.push({
        source: source.source,
        sourceLabel: source.label,
        legacyOnly: source.source === "old",
        category: sheet.title,
        rowIndex,
        hefNo,
        facilityName,
        address: valueFor(row, ["Address", "ADDRESS", "Facility Address"]),
        lga: valueFor(row, ["LGA", "Local Government"]),
        contact: valueFor(row, ["Contact", "Phone", "Phone Number", "Telephone"]),
        email: valueFor(row, ["Facility E-Mail", "Facility Email", "Email", "E-Mail"]),
        row,
      });
    });
    if (results.length >= limit) break;
  }

  return results.slice(0, limit);
}

export async function GET(request: Request) {
  console.log("[/api/facilities/search] started");

  try {
    const { searchParams } = new URL(request.url);
    const query = (searchParams.get("query") ?? "").trim();
    const category = searchParams.get("category") || undefined;
    const requestedLimit = Number(searchParams.get("limit") ?? 75);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 75, 100));

    if (!query) return NextResponse.json({ success: true, ok: true, data: [] });

    let results = await searchSource(sources[0], query, category, limit);
    if (!results.length) {
      results = await searchSource(sources[1], query, category, limit);
    }

    return NextResponse.json({ success: true, ok: true, data: results, count: results.length });
  } catch (error) {
    console.error("[/api/facilities/search] failed", error);
    return NextResponse.json(errorPayload(error), { status: 500 });
  }
}
