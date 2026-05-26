import {
  getAllSheetData,
  getConfiguredSpreadsheetId,
  readExistingRecords,
  readSheetHeaders,
  readSheetTabs,
  withSpreadsheetId,
} from "@/lib/googleSheets";
import type { SheetHeaderResult, SheetRow, SheetRowsResult, SheetTab } from "@/types/sheet";

export type WorkbookSource = "active" | "old";

export type WorkbookSourceConfig = {
  source: WorkbookSource;
  label: string;
  envName: "GOOGLE_SHEET_ID" | "OLD_GOOGLE_SHEET_ID";
  spreadsheetId: string | null;
  configured: boolean;
  readOnly: boolean;
};

export const WORKBOOK_SOURCE_LABELS: Record<WorkbookSource, string> = {
  active: "Hefamaa Active Database",
  old: "Old Hefamaa Database",
};


type SourceCacheEntry<T> = {
  spreadsheetId: string;
  expiresAt: number;
  value: T;
};

type SourceAllSheetData = Record<
  string,
  {
    headers: string[];
    rows: SheetRow[];
  }
>;

type WorkbookSourceRuntimeCache = {
  allSheetData: Map<WorkbookSource, SourceCacheEntry<SourceAllSheetData>>;
  sheetTabs: Map<WorkbookSource, SourceCacheEntry<SheetTab[]>>;
  sheetHeaders: Map<string, SourceCacheEntry<SheetHeaderResult>>;
  sheetRows: Map<string, SourceCacheEntry<SheetRowsResult>>;
};

const sourceGlobalCache = globalThis as typeof globalThis & {
  __hefamaaWorkbookSourceRuntimeCache?: WorkbookSourceRuntimeCache;
};

const sourceRuntimeCache =
  sourceGlobalCache.__hefamaaWorkbookSourceRuntimeCache ??
  (sourceGlobalCache.__hefamaaWorkbookSourceRuntimeCache = {
    allSheetData: new Map(),
    sheetTabs: new Map(),
    sheetHeaders: new Map(),
    sheetRows: new Map(),
  });

function sourceCacheTtlMs() {
  const value = Number(process.env.SHEET_CACHE_TTL_MS);
  return Number.isFinite(value) && value >= 0 ? value : 60_000;
}

function cloneCacheValue<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function readSourceCache<T>(source: WorkbookSource, spreadsheetId: string, cache: Map<WorkbookSource, SourceCacheEntry<T>>) {
  const entry = cache.get(source);

  if (!entry || sourceCacheTtlMs() === 0 || entry.spreadsheetId !== spreadsheetId || entry.expiresAt <= Date.now()) {
    return null;
  }

  return cloneCacheValue(entry.value);
}

function writeSourceCache<T>(source: WorkbookSource, spreadsheetId: string, cache: Map<WorkbookSource, SourceCacheEntry<T>>, value: T) {
  const ttlMs = sourceCacheTtlMs();

  if (ttlMs === 0) return;

  cache.set(source, {
    spreadsheetId,
    expiresAt: Date.now() + ttlMs,
    value: cloneCacheValue(value),
  });
}

function categoryCacheKey(source: WorkbookSource, category: string) {
  return source + ":" + category.trim().toUpperCase();
}

function readCategorySourceCache<T>(
  source: WorkbookSource,
  spreadsheetId: string,
  category: string,
  cache: Map<string, SourceCacheEntry<T>>,
) {
  const entry = cache.get(categoryCacheKey(source, category));

  if (!entry || sourceCacheTtlMs() === 0 || entry.spreadsheetId !== spreadsheetId || entry.expiresAt <= Date.now()) {
    return null;
  }

  return cloneCacheValue(entry.value);
}

function writeCategorySourceCache<T>(
  source: WorkbookSource,
  spreadsheetId: string,
  category: string,
  cache: Map<string, SourceCacheEntry<T>>,
  value: T,
) {
  const ttlMs = sourceCacheTtlMs();

  if (ttlMs === 0) return;

  cache.set(categoryCacheKey(source, category), {
    spreadsheetId,
    expiresAt: Date.now() + ttlMs,
    value: cloneCacheValue(value),
  });
}

const SOURCE_ENV: Record<WorkbookSource, WorkbookSourceConfig["envName"]> = {
  active: "GOOGLE_SHEET_ID",
  old: "OLD_GOOGLE_SHEET_ID",
};

export function getWorkbookSourceConfig(source: WorkbookSource): WorkbookSourceConfig {
  const envName = SOURCE_ENV[source];
  const spreadsheetId = getConfiguredSpreadsheetId(envName);

  return {
    source,
    label: WORKBOOK_SOURCE_LABELS[source],
    envName,
    spreadsheetId,
    configured: Boolean(spreadsheetId),
    readOnly: source === "old",
  };
}

export function isWorkbookSourceConfigured(source: WorkbookSource) {
  return getWorkbookSourceConfig(source).configured;
}

export async function withWorkbookSource<T>(source: WorkbookSource, operation: () => Promise<T>) {
  const config = getWorkbookSourceConfig(source);

  if (!config.spreadsheetId) {
    throw new Error(config.label + " is not configured. Add " + config.envName + " to .env.local.");
  }

  return withSpreadsheetId(config.spreadsheetId, operation);
}

export async function readSourceSheetTabs(source: WorkbookSource): Promise<SheetTab[]> {
  const config = getWorkbookSourceConfig(source);

  if (!config.spreadsheetId) {
    throw new Error(config.label + " is not configured. Add " + config.envName + " to .env.local.");
  }

  const cached = readSourceCache<SheetTab[]>(source, config.spreadsheetId, sourceRuntimeCache.sheetTabs);

  if (cached) {
    return cached;
  }

  const tabs = await withWorkbookSource(source, readSheetTabs);
  writeSourceCache(source, config.spreadsheetId, sourceRuntimeCache.sheetTabs, tabs);

  return cloneCacheValue(tabs);
}

export async function readSourceSheetHeaders(source: WorkbookSource, category: string): Promise<SheetHeaderResult> {
  const config = getWorkbookSourceConfig(source);

  if (!config.spreadsheetId) {
    throw new Error(config.label + " is not configured. Add " + config.envName + " to .env.local.");
  }

  const cached = readCategorySourceCache<SheetHeaderResult>(source, config.spreadsheetId, category, sourceRuntimeCache.sheetHeaders);

  if (cached) {
    return cached;
  }

  const result = await withWorkbookSource(source, () => readSheetHeaders(category));
  writeCategorySourceCache(source, config.spreadsheetId, result.category, sourceRuntimeCache.sheetHeaders, result);
  writeCategorySourceCache(source, config.spreadsheetId, category, sourceRuntimeCache.sheetHeaders, result);

  return cloneCacheValue(result);
}

export async function readSourceExistingRecords(source: WorkbookSource, category: string): Promise<SheetRowsResult> {
  const config = getWorkbookSourceConfig(source);

  if (!config.spreadsheetId) {
    throw new Error(config.label + " is not configured. Add " + config.envName + " to .env.local.");
  }

  const cached = readCategorySourceCache<SheetRowsResult>(source, config.spreadsheetId, category, sourceRuntimeCache.sheetRows);

  if (cached) {
    return cached;
  }

  const result = await withWorkbookSource(source, () => readExistingRecords(category));
  writeCategorySourceCache(source, config.spreadsheetId, result.category, sourceRuntimeCache.sheetRows, result);
  writeCategorySourceCache(source, config.spreadsheetId, category, sourceRuntimeCache.sheetRows, result);
  writeCategorySourceCache(
    source,
    config.spreadsheetId,
    result.category,
    sourceRuntimeCache.sheetHeaders,
    { category: result.category, headers: result.headers },
  );

  return cloneCacheValue(result);
}

export function clearWorkbookSourceCache(source?: WorkbookSource) {
  if (source) {
    sourceRuntimeCache.allSheetData.delete(source);
    sourceRuntimeCache.sheetTabs.delete(source);

    for (const key of [...sourceRuntimeCache.sheetHeaders.keys()]) {
      if (key.startsWith(source + ":")) sourceRuntimeCache.sheetHeaders.delete(key);
    }

    for (const key of [...sourceRuntimeCache.sheetRows.keys()]) {
      if (key.startsWith(source + ":")) sourceRuntimeCache.sheetRows.delete(key);
    }

    return;
  }

  sourceRuntimeCache.allSheetData.clear();
  sourceRuntimeCache.sheetTabs.clear();
  sourceRuntimeCache.sheetHeaders.clear();
  sourceRuntimeCache.sheetRows.clear();
}

export async function getSourceAllSheetData(source: WorkbookSource): Promise<SourceAllSheetData> {
  const config = getWorkbookSourceConfig(source);

  if (!config.spreadsheetId) {
    throw new Error(config.label + " is not configured. Add " + config.envName + " to .env.local.");
  }

  const cached = readSourceCache<SourceAllSheetData>(source, config.spreadsheetId, sourceRuntimeCache.allSheetData);

  if (cached) {
    return cached;
  }

  const data = (await withWorkbookSource(source, getAllSheetData)) as SourceAllSheetData;
  writeSourceCache(source, config.spreadsheetId, sourceRuntimeCache.allSheetData, data);

  return cloneCacheValue(data);
}
