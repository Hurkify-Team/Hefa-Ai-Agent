import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "fs";
import path from "path";

import {
  readPortalDetailsCacheLightweight,
  readPortalListCacheLightweight,
  type LightweightPortalFacilityDetailRecord,
  type LightweightPortalFacilityRecord,
} from "@/lib/portalCacheStore";

type QaIndexRecord = {
  applicationType?: string;
  capturedAt?: string;
  category?: string;
  facilityName?: string;
  hefamaaId?: string;
  normalizedStatus?: string;
  qaFields?: Record<string, string>;
  qaSearchText?: string;
  recordDate?: string | null;
  registrationStatus?: string;
  renewalYear?: number | null;
  sourceRecord?: LightweightPortalFacilityRecord;
  staffComplement?: Record<string, number>;
  url?: string;
  visibleFields?: Record<string, string>;
};

type QaIndexFile = { records?: QaIndexRecord[]; sourceMtimeMs?: number; version?: number };

type PortalRowsCache = { detailsMtimeMs: number; qaMtimeMs: number; rows: PortalCacheRow[] };

let portalRowsCache: PortalRowsCache | null = null;

export type PortalCacheRow = {
  id: string;
  facility_name: string | null;
  hef_no: string | null;
  category: string | null;
  lga: string | null;
  lcda: string | null;
  address: string | null;
  contact: string | null;
  email: string | null;
  owner_name: string | null;
  registration_status: string | null;
  accreditation_status: string | null;
  inspection_status: string | null;
  requirements_status: string | null;
  doctors_count: number | null;
  nurses_count: number | null;
  raw_portal_text: string | null;
  structured_portal_data: Record<string, unknown>;
  source_url: string | null;
  captured_at: string | null;
  updated_at: string | null;
};

const SECTION_HEADERS = [
  "FACILITY DETAILS",
  "CONTACT DETAILS",
  "PROPRIETORS DETAILS",
  "OPERATIONS DETAILS",
  "MEDICAL PROFESSIONAL IN-CHARGE",
  "QUALIFICATION OF MEDICAL PROFESSIONAL IN-CHARGE",
  "PROFESSIONAL STAFF",
  "NON-PROFESSIONAL STAFF",
  "ADMIN ACTIVITIES",
  "QUERIES",
  "DOCUMENTS",
];

function clean(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function localCachePath(envName: string, fallback: string) {
  const configured = process.env[envName]?.trim() || fallback;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function safeMtime(file: string) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function qaIndexPath() {
  return localCachePath("HEFAMAA_PORTAL_QA_INDEX", "data/portal-qa-index.json");
}

function detailsCachePath() {
  return localCachePath("HEFAMAA_PORTAL_DETAILS_CACHE", "data/portal-facility-details-cache.json");
}

function readQaIndexRecords() {
  const file = qaIndexPath();
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as QaIndexFile;
    return Array.isArray(parsed.records) ? parsed.records : [];
  } catch {
    return [];
  }
}

function textOf(record: LightweightPortalFacilityDetailRecord | LightweightPortalFacilityRecord) {
  const maybeDetail = record as LightweightPortalFacilityDetailRecord;
  return clean(maybeDetail.bodyText || maybeDetail.text || (record as LightweightPortalFacilityRecord).text);
}

function linesOf(text: string) {
  return text.split(/\n+/).map(clean).filter(Boolean);
}

function sectionBounds(lines: string[], sectionName: string) {
  const sectionToken = normalize(sectionName);
  const start = lines.findIndex((line) => normalize(line) === sectionToken);
  if (start < 0) return null;

  const sectionTokens = SECTION_HEADERS.map(normalize);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (sectionTokens.includes(normalize(lines[index]))) {
      end = index;
      break;
    }
  }

  return { end, start };
}

function valueAfterLabel(lines: string[], labels: string[], start = 0, end = lines.length) {
  const labelTokens = labels.map(normalize);
  for (let index = start; index < end; index += 1) {
    if (!labelTokens.includes(normalize(lines[index]))) continue;
    for (let next = index + 1; next < end; next += 1) {
      const candidate = clean(lines[next]);
      if (!candidate || /^(download|print|close|view|edit|save|active)$/i.test(candidate)) continue;
      return candidate;
    }
  }
  return "";
}

function sectionValue(text: string, sectionName: string, labels: string[]) {
  const lines = linesOf(text);
  const bounds = sectionBounds(lines, sectionName);
  if (!bounds) return "";
  return valueAfterLabel(lines, labels, bounds.start + 1, bounds.end);
}

function globalValue(text: string, labels: string[], fields?: Record<string, string>) {
  const labelTokens = labels.map(normalize);
  for (const [key, value] of Object.entries(fields ?? {})) {
    const keyToken = normalize(key);
    if (labelTokens.some((label) => keyToken === label || keyToken.includes(label))) {
      const cleaned = clean(value);
      if (cleaned) return cleaned;
    }
  }
  return valueAfterLabel(linesOf(text), labels);
}

function emailFromText(text: string) {
  const matches = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase()))).at(-1) ?? "";
}

function phoneFromText(text: string) {
  const labelled = sectionValue(text, "CONTACT DETAILS", ["PHONE NUMBER", "PHONE", "CONTACT"]);
  if (labelled) return labelled;
  return clean(text.match(/(?:\+?234|0)\d[\d\s-]{7,}/)?.[0] ?? "");
}

function staffCount(record: LightweightPortalFacilityDetailRecord, aliases: string[]) {
  const direct = Object.entries(record.staffComplement ?? {}).find(([key]) => aliases.some((alias) => normalize(key).includes(normalize(alias))));
  if (direct && Number(direct[1]) > 0) return Number(direct[1]);

  const text = textOf(record);
  const lines = linesOf(text);
  const bounds = sectionBounds(lines, "PROFESSIONAL STAFF");
  if (!bounds) return null;

  let count = 0;
  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    if (normalize(lines[index]) !== "complement") continue;
    const complement = normalize(lines[index + 1]);
    if (aliases.some((alias) => complement.includes(normalize(alias)))) count += 1;
  }
  return count || null;
}

function inferStatusPart(status: string, part: "accreditation" | "inspection" | "requirements") {
  if (part === "requirements") {
    if (/quer/i.test(status)) return "queried";
    if (/pending\s+document|upload\s+payment|payment\s+approved/i.test(status)) return "pending";
    if (/document\s+approved|registration\s+approved|final\s+approval/i.test(status)) return "approved";
  }
  if (part === "inspection") {
    if (/inspection\s+report\s+upload\s+pending/i.test(status)) return "report_upload_pending";
    if (/inspection\s+report\s+pending/i.test(status)) return "inspection_pending";
    if (/final\s+approval|registration\s+approved/i.test(status)) return "inspection_completed";
  }
  if (part === "accreditation") {
    if (/expired/i.test(status)) return "expired";
    if (/registration\s+approved|license|licence/i.test(status)) return "active";
  }
  return null;
}

function rowId(record: LightweightPortalFacilityDetailRecord | LightweightPortalFacilityRecord, index: number) {
  const parts = [record.hefamaaId, record.facilityName, record.category, record.renewalYear, index].map(clean).join("|");
  return "portal-" + createHash("sha1").update(parts).digest("base64url").slice(0, 28);
}

function detailToRow(record: LightweightPortalFacilityDetailRecord, index: number): PortalCacheRow {
  const text = textOf(record);
  const fields = record.visibleFields ?? {};
  const status = clean(record.registrationStatus || record.normalizedStatus);
  const structuredData = {
    applicationType: record.applicationType ?? null,
    fieldIndex: record.fieldIndex ?? null,
    renewalYear: record.renewalYear ?? record.sourceRecord?.renewalYear ?? null,
    formFields: record.formFields ?? null,
    staffComplement: record.staffComplement ?? null,
    staffDetails: record.staffDetails ?? null,
    tables: record.tables ?? null,
    visibleFields: fields,
  };

  return {
    id: rowId(record, index),
    facility_name: clean(record.facilityName) || null,
    hef_no: clean(record.hefamaaId) || globalValue(text, ["HEF/NO", "HEF NO", "FACILITY CODE"], fields) || null,
    category: clean(record.category) || null,
    lga: sectionValue(text, "CONTACT DETAILS", ["LGA", "LOCAL GOVERNMENT"]) || globalValue(text, ["LGA", "LOCAL GOVERNMENT"], fields) || null,
    lcda: sectionValue(text, "CONTACT DETAILS", ["LCDA"]) || globalValue(text, ["LCDA"], fields) || null,
    address: sectionValue(text, "CONTACT DETAILS", ["ADDRESS", "FACILITY ADDRESS"]) || globalValue(text, ["ADDRESS", "FACILITY ADDRESS"], fields) || null,
    contact: sectionValue(text, "CONTACT DETAILS", ["PHONE NUMBER", "PHONE", "CONTACT"]) || globalValue(text, ["PHONE NUMBER", "PHONE", "CONTACT"], fields) || phoneFromText(text) || null,
    email: globalValue(text, ["EMAIL", "E-MAIL", "FACILITY EMAIL"], fields) || emailFromText(text) || null,
    owner_name: sectionValue(text, "PROPRIETORS DETAILS", ["NAME", "OWNER NAME", "PROPRIETOR NAME"]) || globalValue(text, ["OWNER'S NAME", "OWNER NAME", "PROPRIETOR"], fields) || null,
    registration_status: status || null,
    accreditation_status: inferStatusPart(status, "accreditation"),
    inspection_status: inferStatusPart(status, "inspection"),
    requirements_status: inferStatusPart(status, "requirements"),
    doctors_count: staffCount(record, ["doctor", "medical doctor", "consultant"]),
    nurses_count: staffCount(record, ["nurse", "midwife"]),
    raw_portal_text: text || null,
    structured_portal_data: structuredData,
    source_url: clean(record.url) || null,
    captured_at: clean(record.capturedAt) || null,
    updated_at: clean(record.capturedAt) || clean(record.sourceRecord?.lastSeen) || null,
  };
}

function qaToRow(record: QaIndexRecord, index: number): PortalCacheRow {
  const fields = record.qaFields ?? {};
  const mergedFields = { ...(record.visibleFields ?? {}), ...fields };
  const text = clean(record.qaSearchText);
  const status = clean(record.registrationStatus || record.normalizedStatus || fields.status);
  return {
    id: rowId(record as LightweightPortalFacilityRecord, index),
    facility_name: clean(record.facilityName) || null,
    hef_no: clean(record.hefamaaId) || null,
    category: clean(record.category || fields.category) || null,
    lga: clean(fields.lga) || clean(record.visibleFields?.LGA) || null,
    lcda: clean(fields.lcda) || clean(record.visibleFields?.LCDA) || null,
    address: clean(fields.address) || null,
    contact: globalValue(text, ["PHONE NUMBER", "PHONE", "CONTACT"], mergedFields) || clean(fields.contact_phone) || null,
    email: globalValue(text, ["EMAIL", "E-MAIL", "FACILITY EMAIL"], mergedFields) || clean(fields.email) || null,
    owner_name: clean(fields.owner) || null,
    registration_status: status || null,
    accreditation_status: inferStatusPart(status, "accreditation"),
    inspection_status: inferStatusPart(status, "inspection"),
    requirements_status: inferStatusPart(status, "requirements"),
    doctors_count: Number(record.staffComplement?.Doctors || 0) || null,
    nurses_count: Number(record.staffComplement?.Nurses || 0) || null,
    raw_portal_text: clean(record.qaSearchText) || null,
    structured_portal_data: { qaFields: fields, renewalYear: record.renewalYear ?? record.sourceRecord?.renewalYear ?? null, staffComplement: record.staffComplement ?? null, visibleFields: record.visibleFields ?? null },
    source_url: clean(record.url) || null,
    captured_at: clean(record.capturedAt) || null,
    updated_at: clean(record.capturedAt) || clean(record.sourceRecord?.lastSeen) || null,
  };
}

function listToRow(record: LightweightPortalFacilityRecord, index: number): PortalCacheRow {
  const text = textOf(record);
  const status = clean(record.registrationStatus || record.normalizedStatus);
  return {
    id: rowId(record, index),
    facility_name: clean(record.facilityName) || null,
    hef_no: clean(record.hefamaaId) || null,
    category: clean(record.category) || null,
    lga: null,
    lcda: null,
    address: null,
    contact: phoneFromText(text) || null,
    email: emailFromText(text) || null,
    owner_name: null,
    registration_status: status || null,
    accreditation_status: inferStatusPart(status, "accreditation"),
    inspection_status: inferStatusPart(status, "inspection"),
    requirements_status: inferStatusPart(status, "requirements"),
    doctors_count: null,
    nurses_count: null,
    raw_portal_text: text || null,
    structured_portal_data: { renewalYear: record.renewalYear ?? null, visibleFields: record.visibleFields ?? null },
    source_url: null,
    captured_at: clean(record.lastSeen) || null,
    updated_at: clean(record.lastSeen) || null,
  };
}

function uniqueRows(rows: PortalCacheRow[]) {
  const bestByKey = new Map<string, PortalCacheRow>();
  for (const row of rows) {
    const key = [row.facility_name, row.category, row.hef_no].map(normalize).join("|");
    const existing = bestByKey.get(key);
    if (!existing) {
      bestByKey.set(key, row);
      continue;
    }

    // Detail rows are more valuable than list-only rows, and newer captures are
    // preferred when a facility has several yearly renewal portal records.
    const rowScore = (row.raw_portal_text?.length ?? 0) + (row.captured_at ? Date.parse(row.captured_at) || 0 : 0) / 1_000_000;
    const existingScore = (existing.raw_portal_text?.length ?? 0) + (existing.captured_at ? Date.parse(existing.captured_at) || 0 : 0) / 1_000_000;
    if (rowScore > existingScore) bestByKey.set(key, row);
  }
  return [...bestByKey.values()];
}

export function clearPortalCacheRowsCache() {
  portalRowsCache = null;
}

export function readPortalCacheRows() {
  const detailsMtimeMs = safeMtime(detailsCachePath());
  const qaMtimeMs = safeMtime(qaIndexPath());
  if (portalRowsCache?.detailsMtimeMs === detailsMtimeMs && portalRowsCache.qaMtimeMs === qaMtimeMs) {
    return portalRowsCache.rows;
  }

  const qaRecords = readQaIndexRecords();
  const detailRows = qaRecords.length
    ? qaRecords.map(qaToRow)
    : readPortalDetailsCacheLightweight().map(detailToRow);
  const listRows = readPortalListCacheLightweight().map(listToRow);
  const rows = uniqueRows([...detailRows, ...listRows]);
  portalRowsCache = { detailsMtimeMs, qaMtimeMs, rows };
  return rows;
}

export function portalRowMatchesText(row: PortalCacheRow, query: string) {
  const haystack = normalize([
    row.facility_name,
    row.hef_no,
    row.category,
    row.lga,
    row.lcda,
    row.address,
    row.contact,
    row.email,
    row.owner_name,
    row.registration_status,
  ].join(" "));
  const tokens = normalize(query).split(/\s+/).filter((token) => token.length > 1);
  return tokens.length > 0 && tokens.every((token) => haystack.includes(token));
}
