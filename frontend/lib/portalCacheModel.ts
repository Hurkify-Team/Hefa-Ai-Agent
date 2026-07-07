import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "fs";

import { configuredRuntimeFile } from "@/lib/runtimeData";

import {
  readPortalDetailsCacheLightweight,
  readPortalListCacheLightweight,
  type LightweightPortalFacilityDetailRecord,
  type LightweightPortalFacilityRecord,
} from "@/lib/portalCacheStore";

type QaIndexRecord = {
  admissionBeds?: number | null;
  applicationType?: string;
  bedDistribution?: { admissionBeds?: number | null; observationBeds?: number | null; couches?: number | null };
  couches?: number | null;
  capturedAt?: string;
  category?: string;
  documents?: Array<{ available?: boolean | null; name?: string; status?: string; text?: string }>;
  facilityDetails?: Record<string, unknown>;
  facilityName?: string;
  facilityResources?: Record<string, unknown>;
  identification?: Record<string, unknown>;
  hefamaaId?: string;
  normalizedStatus?: string;
  nonProfessionalStaff?: Record<string, unknown>;
  observationBeds?: number | null;
  operatingOfficer?: Record<string, unknown>;
  operations?: Record<string, unknown>;
  professionalStaff?: Array<Record<string, unknown>>;
  proprietorDetails?: Record<string, unknown>;
  qaFields?: Record<string, string>;
  qaSearchText?: string;
  recordDate?: string | null;
  registrationStatus?: string;
  renewalYear?: number | null;
  sourceRecord?: LightweightPortalFacilityRecord;
  staffComplement?: Record<string, number>;
  url?: string;
  visibleFields?: Record<string, string>;
  workflow?: Record<string, unknown>;
  registrationApprovedAt?: string | null;
  approvalMonth?: string | null;
  approvalYear?: string | null;
  approvalDateSource?: string | null;
  approvalDateWarning?: string | null;
};

type QaIndexFile = { records?: QaIndexRecord[]; sourceMtimeMs?: number; version?: number };

type PortalRowsCache = { detailsMtimeMs: number; qaMtimeMs: number; rows: PortalCacheRow[] };

let portalRowsCache: PortalRowsCache | null = null;

export type PortalCacheRow = {
  id: string;
  facility_name: string | null;
  hef_no: string | null;
  category: string | null;
  sector: string | null;
  lga: string | null;
  lcda: string | null;
  address: string | null;
  contact: string | null;
  email: string | null;
  admissionBeds: number | null;
  observationBeds: number | null;
  couches: number | null;
  bedDistribution: { admissionBeds: number | null; observationBeds: number | null; couches: number | null };
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
  registrationApprovedAt: string | null;
  approvalMonth: string | null;
  approvalYear: string | null;
  approvalDateSource: string | null;
  approvalDateWarning: string | null;
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
  return configuredRuntimeFile(envName, fallback);
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


function valueFromObjectPath(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return clean(current);
}

function normalizeFacilitySector(value: unknown): "PUBLIC" | "PRIVATE" | "UNKNOWN" {
  const text = normalize(value);
  if (!text) return "UNKNOWN";
  if (/\b(public|government|govt)\b/.test(text) || /government owned|public sector/.test(text)) return "PUBLIC";
  if (/\b(private|privately)\b/.test(text) || /private owned|privately owned|private sector/.test(text)) return "PRIVATE";
  return "UNKNOWN";
}

function sectorFromRecord(input: { fields?: Record<string, string>; structured?: Record<string, unknown>; text?: string }) {
  const structured = input.structured ?? {};
  const explicit = valueFromObjectPath(structured, ["identification", "facilitySector"])
    || valueFromObjectPath(structured, ["Identification", "facilitySector"]);
  const fromFields = globalValue(input.text ?? "", ["FACILITY SECTOR", "SECTOR", "OWNERSHIP", "OWNERSHIP TYPE"], input.fields);
  const fromText = valueAfterLabel(linesOf(input.text ?? ""), ["FACILITY SECTOR", "SECTOR", "OWNERSHIP", "OWNERSHIP TYPE"]);
  const raw = explicit || fromFields || fromText;
  const normalized = normalizeFacilitySector(raw);
  return normalized === "UNKNOWN" ? null : normalized;
}


function valueFromObjectAliases(value: unknown, aliases: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const normalizedAliases = aliases.map(normalize).filter(Boolean);
  for (const [key, fieldValue] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalize(key);
    if (normalizedAliases.some((alias) => normalizedKey === alias || normalizedKey.includes(alias) || alias.includes(normalizedKey))) {
      const cleaned = clean(fieldValue);
      if (cleaned) return cleaned;
    }
  }
  return "";
}

function parsePortalDateValue(value: unknown) {
  const text = clean(value).replace(/(\d+)(st|nd|rd|th)\b/gi, "$1").replace(/,/g, " ");
  if (!text || /^(n\/?a|not applicable|null|nil|none|-|—)$/i.test(text)) return null;

  const numeric = text.match(/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})\b/);
  if (numeric) {
    let first = Number(numeric[1]);
    let second = Number(numeric[2]);
    let year = Number(numeric[3]);
    if (year < 100) year += 2000;
    const day = first > 12 ? first : second > 12 ? second : first;
    const month = first > 12 ? second : second > 12 ? first : second;
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate())).toISOString();
  }

  const yearOnly = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearOnly) return new Date(Date.UTC(Number(yearOnly[1]), 0, 1)).toISOString();
  return null;
}

function monthFromIso(value: string | null) {
  return value ? value.slice(0, 7) : null;
}

function yearFromIso(value: string | null) {
  return value ? value.slice(0, 4) : null;
}

function approvalInfoForRecord(input: {
  capturedAt?: string | null;
  fields?: Record<string, string>;
  recordDate?: string | null;
  structured?: Record<string, unknown>;
  text?: string;
  updatedAt?: string | null;
}) {
  const fields = input.fields ?? {};
  const workflow = input.structured?.workflow && typeof input.structured.workflow === "object" && !Array.isArray(input.structured.workflow)
    ? input.structured.workflow as Record<string, unknown>
    : {};
  const identification = input.structured?.identification && typeof input.structured.identification === "object" && !Array.isArray(input.structured.identification)
    ? input.structured.identification as Record<string, unknown>
    : {};
  const text = input.text ?? "";

  const candidates = [
    { source: "registrationApprovedDate", value: clean(workflow.registrationApprovedDate) || valueFromObjectAliases(workflow, ["registration approved date"]) || globalValue(text, ["Registration Approved Date"], fields) },
    { source: "approvalDate", value: clean(workflow.approvalDate) || valueFromObjectAliases(workflow, ["approval date", "approved date", "date of approval"]) || globalValue(text, ["Approval Date", "Approved Date", "Date of Approval"], fields) },
    { source: "lastActivityDate", value: clean(workflow.lastActivityDate) || globalValue(text, ["Last Activity Date", "Last Activity"], fields) },
    { source: "registrationDate", value: clean(workflow.registrationDate) || clean(identification.registrationDate) || clean(input.recordDate) || globalValue(text, ["Registration Date", "Date Registered", "Date of Registration"], fields) },
    { source: "capturedAt", value: clean(input.capturedAt) || clean(input.updatedAt) },
  ];

  for (const candidate of candidates) {
    const parsed = parsePortalDateValue(candidate.value);
    if (!parsed) continue;
    const isFallback = candidate.source === "capturedAt";
    return {
      approvalDateSource: candidate.source,
      approvalDateWarning: isFallback ? "Approval date was not visible; captured/scanned date is retained only as a fallback and excluded from monthly/yearly approval trends." : null,
      approvalMonth: isFallback ? null : monthFromIso(parsed),
      approvalYear: isFallback ? null : yearFromIso(parsed),
      registrationApprovedAt: parsed,
    };
  }

  return {
    approvalDateSource: null,
    approvalDateWarning: "Registration approved date was not captured from the portal cache.",
    approvalMonth: null,
    approvalYear: null,
    registrationApprovedAt: null,
  };
}

function parseBedNumber(value: unknown) {
  const text = clean(value);
  if (!text || /^(n\/?a|not applicable|null|nil|none|-|—)$/i.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

const BED_ALIASES = {
  admissionBeds: ["Admission Bed", "Admission Beds", "ADMISSION BEDS", "No of Admission Beds"],
  observationBeds: ["Observation Bed", "Observation Beds", "OBSERVATION BEDS", "No of Observation Beds"],
  couches: ["No of Couches", "Couches", "COUCHES", "Number of Couches"],
};

function bedValueFromRecord(record: { admissionBeds?: number | null; observationBeds?: number | null; couches?: number | null; bedDistribution?: { admissionBeds?: number | null; observationBeds?: number | null; couches?: number | null } }, key: "admissionBeds" | "observationBeds" | "couches", text: string, fields?: Record<string, string>) {
  const direct = record[key];
  if (typeof direct === "number") return direct;
  const distributed = record.bedDistribution?.[key];
  if (typeof distributed === "number") return distributed;
  return parseBedNumber(globalValue(text, BED_ALIASES[key], fields));
}

function bedDistributionForRecord(record: { admissionBeds?: number | null; observationBeds?: number | null; couches?: number | null; bedDistribution?: { admissionBeds?: number | null; observationBeds?: number | null; couches?: number | null } }, text: string, fields?: Record<string, string>) {
  return {
    admissionBeds: bedValueFromRecord(record, "admissionBeds", text, fields),
    observationBeds: bedValueFromRecord(record, "observationBeds", text, fields),
    couches: bedValueFromRecord(record, "couches", text, fields),
  };
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
  const bedDistribution = bedDistributionForRecord(record, text, fields);
  const structuredData = {
    applicationType: record.applicationType ?? null,
    bedDistribution,
    documents: record.documents ?? null,
    facilityDetails: record.facilityDetails ?? null,
    facilityResources: record.facilityResources ?? null,
    fieldIndex: record.fieldIndex ?? null,
    identification: record.identification ?? null,
    renewalYear: record.renewalYear ?? record.sourceRecord?.renewalYear ?? null,
    formFields: record.formFields ?? null,
    nonProfessionalStaff: record.nonProfessionalStaff ?? null,
    operatingOfficer: record.operatingOfficer ?? null,
    operations: record.operations ?? null,
    professionalStaff: record.professionalStaff ?? null,
    proprietorDetails: record.proprietorDetails ?? null,
    staffComplement: record.staffComplement ?? null,
    staffDetails: record.staffDetails ?? null,
    tables: record.tables ?? null,
    visibleFields: fields,
    workflow: record.workflow ?? null,
  };

  const approvalInfo = approvalInfoForRecord({ capturedAt: record.capturedAt, fields, recordDate: record.recordDate, structured: structuredData, text, updatedAt: record.sourceRecord?.lastSeen });

  return {
    id: rowId(record, index),
    facility_name: clean(record.facilityName) || null,
    hef_no: clean(record.hefamaaId) || globalValue(text, ["HEF/NO", "HEF NO", "FACILITY CODE"], fields) || null,
    category: clean(record.category) || null,
    sector: sectorFromRecord({ fields, structured: structuredData, text }),
    lga: sectionValue(text, "CONTACT DETAILS", ["LGA", "LOCAL GOVERNMENT"]) || globalValue(text, ["LGA", "LOCAL GOVERNMENT"], fields) || null,
    lcda: sectionValue(text, "CONTACT DETAILS", ["LCDA"]) || globalValue(text, ["LCDA"], fields) || null,
    address: sectionValue(text, "CONTACT DETAILS", ["ADDRESS", "FACILITY ADDRESS"]) || globalValue(text, ["ADDRESS", "FACILITY ADDRESS"], fields) || null,
    contact: sectionValue(text, "CONTACT DETAILS", ["PHONE NUMBER", "PHONE", "CONTACT"]) || globalValue(text, ["PHONE NUMBER", "PHONE", "CONTACT"], fields) || phoneFromText(text) || null,
    email: globalValue(text, ["EMAIL", "E-MAIL", "FACILITY EMAIL"], fields) || emailFromText(text) || null,
    admissionBeds: bedDistribution.admissionBeds,
    observationBeds: bedDistribution.observationBeds,
    couches: bedDistribution.couches,
    bedDistribution,
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
    ...approvalInfo,
  };
}

function qaToRow(record: QaIndexRecord, index: number): PortalCacheRow {
  const fields = record.qaFields ?? {};
  const mergedFields = { ...(record.visibleFields ?? {}), ...fields };
  const text = clean(record.qaSearchText);
  const status = clean(record.registrationStatus || record.normalizedStatus || fields.status);
  const bedDistribution = bedDistributionForRecord(record, text, mergedFields);
  const structuredData = {
    bedDistribution,
    documents: record.documents ?? null,
    facilityDetails: record.facilityDetails ?? null,
    facilityResources: record.facilityResources ?? null,
    identification: record.identification ?? null,
    nonProfessionalStaff: record.nonProfessionalStaff ?? null,
    operatingOfficer: record.operatingOfficer ?? null,
    operations: record.operations ?? null,
    professionalStaff: record.professionalStaff ?? null,
    proprietorDetails: record.proprietorDetails ?? null,
    qaFields: fields,
    renewalYear: record.renewalYear ?? record.sourceRecord?.renewalYear ?? null,
    staffComplement: record.staffComplement ?? null,
    visibleFields: record.visibleFields ?? null,
    workflow: record.workflow ?? null,
  };
  const approvalInfo = approvalInfoForRecord({ capturedAt: record.capturedAt, fields: mergedFields, recordDate: record.recordDate, structured: structuredData, text, updatedAt: record.sourceRecord?.lastSeen });

  return {
    id: rowId(record as LightweightPortalFacilityRecord, index),
    facility_name: clean(record.facilityName) || null,
    hef_no: clean(record.hefamaaId) || null,
    category: clean(record.category || fields.category) || null,
    sector: sectorFromRecord({ fields: mergedFields, structured: structuredData, text }),
    lga: clean(fields.lga) || clean(record.visibleFields?.LGA) || null,
    lcda: clean(fields.lcda) || clean(record.visibleFields?.LCDA) || null,
    address: clean(fields.address) || null,
    contact: globalValue(text, ["PHONE NUMBER", "PHONE", "CONTACT"], mergedFields) || clean(fields.contact_phone) || null,
    email: globalValue(text, ["EMAIL", "E-MAIL", "FACILITY EMAIL"], mergedFields) || clean(fields.email) || null,
    admissionBeds: bedDistribution.admissionBeds,
    observationBeds: bedDistribution.observationBeds,
    couches: bedDistribution.couches,
    bedDistribution,
    owner_name: clean(fields.owner) || null,
    registration_status: status || null,
    accreditation_status: inferStatusPart(status, "accreditation"),
    inspection_status: inferStatusPart(status, "inspection"),
    requirements_status: inferStatusPart(status, "requirements"),
    doctors_count: Number(record.staffComplement?.Doctors || 0) || null,
    nurses_count: Number(record.staffComplement?.Nurses || 0) || null,
    raw_portal_text: clean(record.qaSearchText) || null,
    structured_portal_data: structuredData,
    source_url: clean(record.url) || null,
    captured_at: clean(record.capturedAt) || null,
    updated_at: clean(record.capturedAt) || clean(record.sourceRecord?.lastSeen) || null,
    ...approvalInfo,
  };
}

function listToRow(record: LightweightPortalFacilityRecord, index: number): PortalCacheRow {
  const text = textOf(record);
  const status = clean(record.registrationStatus || record.normalizedStatus);
  const structuredData = { renewalYear: record.renewalYear ?? null, visibleFields: record.visibleFields ?? null };
  const approvalInfo = approvalInfoForRecord({ capturedAt: record.lastSeen, fields: record.visibleFields, structured: structuredData, text, updatedAt: record.lastSeen });

  return {
    id: rowId(record, index),
    facility_name: clean(record.facilityName) || null,
    hef_no: clean(record.hefamaaId) || null,
    category: clean(record.category) || null,
    sector: sectorFromRecord({ fields: record.visibleFields, structured: { visibleFields: record.visibleFields ?? null }, text }),
    lga: null,
    lcda: null,
    address: null,
    contact: phoneFromText(text) || null,
    email: emailFromText(text) || null,
    admissionBeds: null,
    observationBeds: null,
    couches: null,
    bedDistribution: { admissionBeds: null, observationBeds: null, couches: null },
    owner_name: null,
    registration_status: status || null,
    accreditation_status: inferStatusPart(status, "accreditation"),
    inspection_status: inferStatusPart(status, "inspection"),
    requirements_status: inferStatusPart(status, "requirements"),
    doctors_count: null,
    nurses_count: null,
    raw_portal_text: text || null,
    structured_portal_data: structuredData,
    source_url: null,
    captured_at: clean(record.lastSeen) || null,
    updated_at: clean(record.lastSeen) || null,
    ...approvalInfo,
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
    row.sector,
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
