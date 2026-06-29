import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";
import type { WorkbookReportSummary } from "@/lib/sheetAnalyzer";

export type CachedWorkbookReportSummary = {
  expiresAt: string;
  generatedAt: string;
  source: "cache" | "manual-refresh" | "default";
  summary: WorkbookReportSummary;
};

function ttlMs() {
  const seconds = Number(process.env.DASHBOARD_CACHE_TTL_SECONDS ?? 600);
  return (Number.isFinite(seconds) && seconds > 0 ? seconds : 600) * 1000;
}

function cachePath() {
  return configuredRuntimeFile("HEFAI_REPORT_CACHE_PATH", "dashboard-report-cache.json");
}

export function emptyWorkbookReportSummary(): WorkbookReportSummary {
  return {
    totalFacilities: 0,
    totalCategories: 0,
    incompleteRecords: 0,
    categorySummary: [],
    lgaSummary: [],
    missingDataSummary: [],
    duplicateSummary: {
      exactDuplicateKeys: 0,
      possibleDuplicateKeys: 0,
    },
  };
}

export function readReportCache(): CachedWorkbookReportSummary | null {
  const file = cachePath();
  try {
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, "utf8")) as CachedWorkbookReportSummary;
    if (!parsed?.summary || !parsed.expiresAt) return null;
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) return null;
    return { ...parsed, source: "cache" };
  } catch (error) {
    console.error("[reportCache] Failed to read report cache", error);
    return null;
  }
}

export function writeReportCache(summary: WorkbookReportSummary, source: CachedWorkbookReportSummary["source"] = "manual-refresh") {
  const generatedAt = new Date();
  const payload: CachedWorkbookReportSummary = {
    expiresAt: new Date(generatedAt.getTime() + ttlMs()).toISOString(),
    generatedAt: generatedAt.toISOString(),
    source,
    summary,
  };
  const file = cachePath();
  ensureRuntimeDataDirForFile(file);
  const temp = file + ".tmp";
  writeFileSync(temp, JSON.stringify(payload, null, 2), "utf8");
  renameSync(temp, file);
  return payload;
}

export function defaultReportCache(): CachedWorkbookReportSummary {
  const generatedAt = new Date().toISOString();
  return {
    expiresAt: new Date(Date.now() + ttlMs()).toISOString(),
    generatedAt,
    source: "default",
    summary: emptyWorkbookReportSummary(),
  };
}
