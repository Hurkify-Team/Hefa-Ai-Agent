import { existsSync, readFileSync, statSync } from "fs";

import { configuredRuntimeFile } from "@/lib/runtimeData";

export type LightweightPortalFacilityRecord = {
  applicationType?: string;
  category?: string;
  facilityName?: string;
  hasAction?: boolean;
  hefamaaId?: string;
  index?: number;
  lastSeen?: string;
  normalizedStatus?: string;
  nonProfessionalStaff?: Record<string, unknown>;
  observationBeds?: number | null;
  operatingOfficer?: Record<string, unknown>;
  operations?: Record<string, unknown>;
  professionalStaff?: Array<Record<string, unknown>>;
  proprietorDetails?: Record<string, unknown>;
  recordDate?: string | null;
  registrationStatus?: string;
  renewalYear?: number | null;
  text?: string;
  visibleFields?: Record<string, string>;
  workflow?: Record<string, unknown>;
};

export type LightweightPortalFacilityDetailRecord = {
  admissionBeds?: number | null;
  applicationType?: string;
  bedDistribution?: { admissionBeds?: number | null; observationBeds?: number | null; couches?: number | null };
  couches?: number | null;
  bodyText?: string;
  cacheKey?: string;
  capturedAt?: string;
  category?: string;
  documents?: Array<{ available?: boolean | null; name?: string; status?: string; text?: string }>;
  facilityDetails?: Record<string, unknown>;
  facilityName?: string;
  facilityResources?: Record<string, unknown>;
  fieldIndex?: Record<string, string>;
  formFields?: unknown[];
  identification?: Record<string, unknown>;
  hefamaaId?: string;
  normalizedStatus?: string;
  nonProfessionalStaff?: Record<string, unknown>;
  observationBeds?: number | null;
  operatingOfficer?: Record<string, unknown>;
  operations?: Record<string, unknown>;
  professionalStaff?: Array<Record<string, unknown>>;
  proprietorDetails?: Record<string, unknown>;
  recordDate?: string | null;
  registrationStatus?: string;
  renewalYear?: number | null;
  sourceRecord?: LightweightPortalFacilityRecord;
  staffComplement?: Record<string, number>;
  staffDetails?: Array<{ matchedComplements?: string[]; rowIndex?: number; tableIndex?: number; text?: string; values?: string[] }>;
  tables?: string[][][];
  text?: string;
  url?: string;
  visibleFields?: Record<string, string>;
  workflow?: Record<string, unknown>;
};

type FileCache<T> = { mtimeMs: number; path: string; value: T };

let listCache: FileCache<LightweightPortalFacilityRecord[]> | null = null;
let detailsCache: FileCache<LightweightPortalFacilityDetailRecord[]> | null = null;

function cachePath(envName: string, fallback: string) {
  return configuredRuntimeFile(envName, fallback);
}

function fileMtime(file: string) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function readJsonArray<T>(file: string): T[] {
  if (!existsSync(file)) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8"));
  return Array.isArray(parsed) ? parsed : [];
}

// The agent needs fast offline answers. This reader intentionally avoids importing
// the Playwright automation module, because chat/notification APIs only need the
// JSON cache already captured by the scanner.
export function readPortalListCacheLightweight() {
  const file = cachePath("HEFAMAA_PORTAL_CACHE", "data/portal-facilities-cache.json");
  const mtimeMs = fileMtime(file);
  if (listCache?.path === file && listCache.mtimeMs === mtimeMs) return listCache.value;

  const value = readJsonArray<LightweightPortalFacilityRecord>(file);
  listCache = { path: file, mtimeMs, value };
  return value;
}

export function readPortalDetailsCacheLightweight() {
  const file = cachePath("HEFAMAA_PORTAL_DETAILS_CACHE", "data/portal-facility-details-cache.json");
  const mtimeMs = fileMtime(file);
  if (detailsCache?.path === file && detailsCache.mtimeMs === mtimeMs) return detailsCache.value;

  const value = readJsonArray<LightweightPortalFacilityDetailRecord>(file);
  detailsCache = { path: file, mtimeMs, value };
  return value;
}
