import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";

import { readPortalDetailsCacheLightweight, type LightweightPortalFacilityDetailRecord } from "@/lib/portalCacheStore";

type PortalFacilityDetailRecord = LightweightPortalFacilityDetailRecord;

export type StaffIndexRecord = {
  staffName: string;
  normalizedStaffName: string;
  profession: string;
  registrationNumber: string;
  normalizedRegistrationNumber: string;
  rawText: string;
  facilityName: string;
  category: string;
  hefamaaId: string;
  renewalYear: string;
  registrationStatus: string;
  normalizedStatus: string;
  capturedAt: string;
  sourceUrl: string;
};

export type StaffIntegrityIssueType =
  | "same_registration_number_multiple_names"
  | "same_registration_number_multiple_facilities"
  | "same_staff_multiple_registration_numbers"
  | "same_staff_multiple_facilities";

export type StaffIntegrityIssue = {
  type: StaffIntegrityIssueType;
  summary: string;
  key: string;
  records: StaffIndexRecord[];
};

export type StaffQuestionAnswer = {
  answer: string;
  summary: Record<string, unknown>;
  rows: Array<Record<string, unknown>>;
};

type StaffIndexDiskCache = {
  records?: StaffIndexRecord[];
  sourceMtimeMs?: number;
  version?: number;
};

let staffIndexMemoryCache: { records: StaffIndexRecord[]; sourceMtimeMs: number } | null = null;

function dataPath(envName: string, fallback: string) {
  const configured = process.env[envName]?.trim() || fallback;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function detailsCachePath() {
  return dataPath("HEFAMAA_PORTAL_DETAILS_CACHE", "data/portal-facility-details-cache.json");
}

function staffIndexCachePath() {
  return dataPath("HEFAMAA_PORTAL_STAFF_INDEX", "data/portal-staff-index.json");
}

function fileMtimeMs(filePath: string) {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function readStaffIndexDiskCache(sourceMtimeMs: number) {
  const filePath = staffIndexCachePath();
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as StaffIndexDiskCache;
    if (parsed.version !== 1 || parsed.sourceMtimeMs !== sourceMtimeMs || !Array.isArray(parsed.records)) return null;
    return parsed.records;
  } catch {
    return null;
  }
}

function writeStaffIndexDiskCache(sourceMtimeMs: number, records: StaffIndexRecord[]) {
  const filePath = staffIndexCachePath();
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify({ records, sourceMtimeMs, version: 1 }), "utf8");
  } catch {
    // Chat answers still work from memory if the local cache snapshot cannot be written.
  }
}

const PROFESSION_PATTERNS: Array<[RegExp, string]> = [
  [/\bmedical\s+doctor\b|\bdoctor\b|\bphysician\b|\bconsultant\b|\bmd\b/i, "Doctor"],
  [/\bnurse\b|\bnursing\b|\brn\b|\brm\b/i, "Nurse"],
  [/\bpharmacist\b|\bpharmacy\b/i, "Pharmacist"],
  [/\blab(?:oratory)?\s*(?:scientist|sci)\b|\bmls\b/i, "Lab Scientist"],
  [/\blab(?:oratory)?\s*(?:technician|tech)\b/i, "Lab Technician"],
  [/\bradiographer\b|\bradiography\b/i, "Radiographer"],
  [/\bphysiotherapist\b|\bphysiotherapy\b/i, "Physiotherapist"],
  [/\boptometrist\b|\boptometry\b/i, "Optometrist"],
  [/\bdentist\b|\bdental\b/i, "Dentist"],
  [/\bcommunity\s+health\b|\bchew\b|\bcho\b/i, "Community Health"],
  [/\bhealth\s+assistant\b|\bhealth\s+attendant\b/i, "Health Assistant"],
];

const REGISTRATION_PATTERN = /\b(?:MDCN|MLSCN|NMCN|PCN|RRBN|RADCN|EHORECON|CHPRBN|MRTB|ODORBN|OPTOM|DENTAL|NANNM|FMLSCN|MLS)\s*[\/:#.-]?\s*[A-Z0-9][A-Z0-9\/. -]{2,}\b/i;
const GENERIC_REGISTRATION_PATTERN = /\b(?:registration|reg\.?|license|licence|folio|pin)\s*(?:number|no\.?|#)?\s*[:#-]?\s*([A-Z]{1,8}[A-Z0-9\/. -]{2,}|\d{4,})\b/i;
const STAFF_SECTION_PATTERN = /professional\s+staff|staff\s+details|staff\s+list|medical\s+staff|personnel|qualification|designation|cadre|registration\s+(?:number|no)|licen[cs]e\s+(?:number|no)|folio/i;

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function normalizeName(value: string): string {
  return cleanText(value)
    .toUpperCase()
    .replace(/\b(DR|MR|MRS|MISS|MS|PROF|PHARM|NURSE)\.?\s+/g, "")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeRegistrationNumber(value: string): string {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeStatus(value: string): string {
  return cleanText(value).toLowerCase().replace(/\s+/g, " ");
}

function findProfession(value: string): string {
  const text = cleanText(value);
  for (const [pattern, profession] of PROFESSION_PATTERNS) {
    if (pattern.test(text)) {
      return profession;
    }
  }
  return "";
}

function extractRegistrationNumber(value: string): string {
  const text = cleanText(value);
  const direct = text.match(REGISTRATION_PATTERN);
  if (direct?.[0]) {
    return cleanText(direct[0]).replace(/\s+/g, " ");
  }

  const generic = text.match(GENERIC_REGISTRATION_PATTERN);
  if (generic?.[1]) {
    return cleanText(generic[1]).replace(/\s+/g, " ");
  }

  return "";
}

function looksLikeStaffName(value: string): boolean {
  const text = cleanText(value);
  if (!text || text.length < 5 || text.length > 90) return false;
  if (extractRegistrationNumber(text) || findProfession(text)) return false;
  if (/\d{3,}/.test(text)) return false;
  if (/@|http|www\.|facility|hospital|clinic|laboratory|centre|center|address|status|category|qualification|registration|license|licence|phone|contact|email|date|approved|pending/i.test(text)) return false;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 6) return false;
  return /^[A-Za-z.' -]+$/.test(text);
}

function splitRowText(value: string): string[] {
  return cleanText(value)
    .split(/\s{2,}|\t|\||,\s*(?=[A-Za-z])/)
    .map((part) => cleanText(part))
    .filter(Boolean);
}

function getDetailValue(detail: PortalFacilityDetailRecord, key: string): string {
  const fields = detail.visibleFields ?? {};
  return cleanText((fields as Record<string, unknown>)[key]);
}

function recordBase(detail: PortalFacilityDetailRecord) {
  return {
    facilityName: cleanText(detail.facilityName || getDetailValue(detail, "Name of Facility") || getDetailValue(detail, "Facility Name")),
    category: cleanText(detail.category || getDetailValue(detail, "Facility Type") || getDetailValue(detail, "Facility Category")),
    hefamaaId: cleanText(detail.hefamaaId || getDetailValue(detail, "HEFAMAA ID") || getDetailValue(detail, "HEF/NO")),
    renewalYear: cleanText(detail.renewalYear || getDetailValue(detail, "Year") || getDetailValue(detail, "Renewal Year")),
    registrationStatus: cleanText(detail.registrationStatus || getDetailValue(detail, "Registration Status") || getDetailValue(detail, "Status")),
    normalizedStatus: normalizeStatus(detail.registrationStatus || getDetailValue(detail, "Registration Status") || getDetailValue(detail, "Status")),
    capturedAt: cleanText(detail.capturedAt),
    sourceUrl: cleanText(detail.url),
  };
}

function createStaffRecord(detail: PortalFacilityDetailRecord, input: { name?: string; profession?: string; registrationNumber?: string; rawText: string }): StaffIndexRecord | null {
  const rawText = cleanText(input.rawText);
  const staffName = cleanText(input.name);
  const profession = cleanText(input.profession) || findProfession(rawText);
  const registrationNumber = cleanText(input.registrationNumber) || extractRegistrationNumber(rawText);

  if (!staffName && !registrationNumber) return null;
  if (staffName && !looksLikeStaffName(staffName)) return null;
  if (registrationNumber && normalizeRegistrationNumber(registrationNumber).length < 4) return null;

  const base = recordBase(detail);
  return {
    staffName,
    normalizedStaffName: normalizeName(staffName),
    profession,
    registrationNumber,
    normalizedRegistrationNumber: normalizeRegistrationNumber(registrationNumber),
    rawText,
    ...base,
  };
}

function inferStaffRecordFromParts(detail: PortalFacilityDetailRecord, parts: string[], rawText: string): StaffIndexRecord | null {
  let staffName = "";
  let profession = "";
  let registrationNumber = "";

  for (const part of parts) {
    if (!registrationNumber) registrationNumber = extractRegistrationNumber(part);
    if (!profession) profession = findProfession(part);
    if (!staffName && looksLikeStaffName(part)) staffName = part;
  }

  return createStaffRecord(detail, { name: staffName, profession, registrationNumber, rawText });
}

function parseStaffDetailRows(detail: PortalFacilityDetailRecord): StaffIndexRecord[] {
  const records: StaffIndexRecord[] = [];
  const rows = Array.isArray(detail.staffDetails) ? detail.staffDetails : [];

  for (const row of rows) {
    const values = Array.isArray(row.values) ? row.values.map(cleanText).filter(Boolean) : [];
    const rawText = cleanText(row.text || values.join(" | "));
    const parsed = inferStaffRecordFromParts(detail, values.length ? values : splitRowText(rawText), rawText);
    if (parsed) records.push(parsed);
  }

  return records;
}

function tableRows(table: unknown): string[][] {
  if (Array.isArray(table)) {
    return table
      .map((row) => Array.isArray(row) ? row.map(cleanText).filter(Boolean) : splitRowText(cleanText(row)))
      .filter((row) => row.length > 0);
  }

  const candidate = table as { rows?: unknown; text?: unknown };
  if (Array.isArray(candidate.rows)) {
    return candidate.rows
      .map((row) => Array.isArray(row) ? row.map(cleanText).filter(Boolean) : splitRowText(cleanText(row)))
      .filter((row) => row.length > 0);
  }

  return cleanText(candidate.text)
    .split("\n")
    .map(splitRowText)
    .filter((row) => row.length > 0);
}

function findHeaderIndex(headers: string[], pattern: RegExp): number {
  return headers.findIndex((header) => pattern.test(header));
}

function parseStaffTables(detail: PortalFacilityDetailRecord): StaffIndexRecord[] {
  const records: StaffIndexRecord[] = [];
  const tables = Array.isArray(detail.tables) ? detail.tables : [];

  for (const table of tables) {
    const rows = tableRows(table);
    const tableText = rows.map((row) => row.join(" | ")).join("\n");
    if (!STAFF_SECTION_PATTERN.test(tableText)) continue;

    const headers = rows[0] ?? [];
    const nameIndex = findHeaderIndex(headers, /\b(name|staff)\b/i);
    const professionIndex = findHeaderIndex(headers, /profession|designation|cadre|role|position/i);
    const registrationIndex = findHeaderIndex(headers, /registration|reg\.?\s*(?:no|number)?|licen[cs]e|folio|pin|mdcn|mlscn|nmcn|pcn/i);
    const startIndex = nameIndex >= 0 || professionIndex >= 0 || registrationIndex >= 0 ? 1 : 0;

    for (const row of rows.slice(startIndex)) {
      const rawText = row.join(" | ");
      const byHeader = createStaffRecord(detail, {
        name: nameIndex >= 0 ? row[nameIndex] : "",
        profession: professionIndex >= 0 ? row[professionIndex] : "",
        registrationNumber: registrationIndex >= 0 ? row[registrationIndex] : "",
        rawText,
      });
      const parsed = byHeader ?? inferStaffRecordFromParts(detail, row, rawText);
      if (parsed) records.push(parsed);
    }
  }

  return records;
}

function parseVisibleStaffBlocks(detail: PortalFacilityDetailRecord): StaffIndexRecord[] {
  const records: StaffIndexRecord[] = [];
  const fields = detail.visibleFields ?? {};

  for (const [label, value] of Object.entries(fields as Record<string, unknown>)) {
    const text = cleanText(value);
    if (!text) continue;
    if (!STAFF_SECTION_PATTERN.test(label + "\n" + text)) continue;

    for (const line of text.split("\n")) {
      const row = splitRowText(line);
      const parsed = inferStaffRecordFromParts(detail, row, line);
      if (parsed) records.push(parsed);
    }
  }

  return records;
}

function sectionLinesFromBody(detail: PortalFacilityDetailRecord, startLabel: RegExp, stopLabel: RegExp): string[] {
  const lines = cleanText(detail.bodyText || detail.text)
    .replace(/^VISIBLE PAGE TEXT:\s*/i, "")
    .split("\n")
    .map(cleanText)
    .filter(Boolean);
  const start = lines.findIndex((line) => startLabel.test(line));
  if (start < 0) return [];
  const endOffset = lines.slice(start + 1).findIndex((line) => stopLabel.test(line));
  const end = endOffset >= 0 ? start + 1 + endOffset : lines.length;
  return lines.slice(start + 1, end);
}

function valueAfterLabel(lines: string[], label: RegExp, startIndex = 0): string {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!label.test(lines[index])) continue;
    for (let next = index + 1; next < lines.length; next += 1) {
      const value = cleanText(lines[next]);
      if (!value || /^download|^print facility information/i.test(value)) continue;
      return value;
    }
  }
  return "";
}

function splitProfessionalStaffBlocks(lines: string[]): string[][] {
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (/^NAME$/i.test(line) && current.length) {
      blocks.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length) blocks.push(current);
  return blocks;
}

function parseProfessionalStaffBodyText(detail: PortalFacilityDetailRecord): StaffIndexRecord[] {
  const lines = sectionLinesFromBody(detail, /^PROFESSIONAL STAFF$/i, /^(NON-PROFESSIONAL STAFF|ADMIN ACTIVITIES|QUERIES|PRINT FACILITY INFORMATION)$/i);
  if (!lines.length) return [];

  return splitProfessionalStaffBlocks(lines)
    .map((block) => createStaffRecord(detail, {
      name: valueAfterLabel(block, /^NAME$/i),
      profession: valueAfterLabel(block, /^COMPLEMENT$/i),
      registrationNumber: valueAfterLabel(block, /^REG\.? NUMBER$/i),
      rawText: block.join(" | "),
    }))
    .filter((record): record is StaffIndexRecord => Boolean(record));
}

function dedupe(records: StaffIndexRecord[]): StaffIndexRecord[] {
  const seen = new Set<string>();
  const unique: StaffIndexRecord[] = [];

  for (const record of records) {
    const key = [
      record.normalizedStaffName,
      record.normalizedRegistrationNumber,
      record.facilityName.toUpperCase(),
      record.hefamaaId.toUpperCase(),
      record.renewalYear,
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(record);
  }

  return unique;
}

export function buildStaffIndex(): StaffIndexRecord[] {
  const sourceMtimeMs = fileMtimeMs(detailsCachePath());
  if (staffIndexMemoryCache?.sourceMtimeMs === sourceMtimeMs) return staffIndexMemoryCache.records;

  const diskRecords = readStaffIndexDiskCache(sourceMtimeMs);
  if (diskRecords) {
    staffIndexMemoryCache = { records: diskRecords, sourceMtimeMs };
    return diskRecords;
  }

  const details = readPortalDetailsCacheLightweight();
  const records: StaffIndexRecord[] = [];

  for (const detail of details) {
    records.push(...parseStaffDetailRows(detail));
    records.push(...parseStaffTables(detail));
    records.push(...parseVisibleStaffBlocks(detail));
    records.push(...parseProfessionalStaffBodyText(detail));
  }

  const unique = dedupe(records);
  staffIndexMemoryCache = { records: unique, sourceMtimeMs };
  writeStaffIndexDiskCache(sourceMtimeMs, unique);
  return unique;
}

function groupBy(records: StaffIndexRecord[], keyFn: (record: StaffIndexRecord) => string): Map<string, StaffIndexRecord[]> {
  const groups = new Map<string, StaffIndexRecord[]>();
  for (const record of records) {
    const key = keyFn(record);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
  return groups;
}

function uniqueCount(records: StaffIndexRecord[], keyFn: (record: StaffIndexRecord) => string): number {
  return new Set(records.map(keyFn).filter(Boolean)).size;
}

export function findStaffIntegrityIssues(records = buildStaffIndex()): StaffIntegrityIssue[] {
  const issues: StaffIntegrityIssue[] = [];

  for (const [registrationNumber, group] of groupBy(records, (record) => record.normalizedRegistrationNumber)) {
    if (group.length < 2) continue;
    if (uniqueCount(group, (record) => record.normalizedStaffName) > 1) {
      issues.push({
        type: "same_registration_number_multiple_names",
        key: registrationNumber,
        summary: "Registration number " + registrationNumber + " appears under multiple staff names.",
        records: group,
      });
    }
    if (uniqueCount(group, (record) => record.facilityName.toUpperCase()) > 1) {
      issues.push({
        type: "same_registration_number_multiple_facilities",
        key: registrationNumber,
        summary: "Registration number " + registrationNumber + " appears in multiple facilities.",
        records: group,
      });
    }
  }

  for (const [staffName, group] of groupBy(records, (record) => record.normalizedStaffName)) {
    if (group.length < 2) continue;
    if (uniqueCount(group, (record) => record.normalizedRegistrationNumber) > 1) {
      issues.push({
        type: "same_staff_multiple_registration_numbers",
        key: staffName,
        summary: "Staff name " + staffName + " appears with multiple registration numbers.",
        records: group,
      });
    }
    if (uniqueCount(group, (record) => record.facilityName.toUpperCase()) > 1) {
      issues.push({
        type: "same_staff_multiple_facilities",
        key: staffName,
        summary: "Staff name " + staffName + " appears in multiple facilities. Review whether this is valid employment or duplicate entry.",
        records: group,
      });
    }
  }

  return issues;
}

export function publicStaffRow(record: StaffIndexRecord): Record<string, unknown> {
  return {
    staffName: record.staffName,
    profession: record.profession,
    registrationNumber: record.registrationNumber,
    facilityName: record.facilityName,
    category: record.category,
    hefamaaId: record.hefamaaId,
    renewalYear: record.renewalYear,
    registrationStatus: record.registrationStatus,
    capturedAt: record.capturedAt,
    sourceUrl: record.sourceUrl,
  };
}

function scoreMatch(record: StaffIndexRecord, query: string): number {
  const nameQuery = normalizeName(query);
  const regQuery = normalizeRegistrationNumber(query);
  let score = 0;

  if (nameQuery && record.normalizedStaffName === nameQuery) score += 100;
  else if (nameQuery && record.normalizedStaffName.includes(nameQuery)) score += 70;
  else if (nameQuery && nameQuery.includes(record.normalizedStaffName)) score += 55;

  if (regQuery && record.normalizedRegistrationNumber === regQuery) score += 100;
  else if (regQuery && record.normalizedRegistrationNumber.includes(regQuery)) score += 70;

  return score;
}

export function searchStaffIntelligence(query: string, records = buildStaffIndex()): StaffIndexRecord[] {
  const cleanQuery = cleanText(query);
  if (!cleanQuery) return [];

  return records
    .map((record) => ({ record, score: scoreMatch(record, cleanQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.record);
}

function renewalYearNumber(record: StaffIndexRecord) {
  const year = Number(String(record.renewalYear || "").match(/20\d{2}/)?.[0] ?? 0);
  return Number.isFinite(year) ? year : 0;
}

function capturedTime(record: StaffIndexRecord) {
  const time = Date.parse(record.capturedAt || "");
  return Number.isFinite(time) ? time : 0;
}

function recencyScore(record: StaffIndexRecord) {
  return renewalYearNumber(record) * 10_000_000_000_000 + capturedTime(record);
}

function distinctFacilityKey(record: StaffIndexRecord) {
  const facility = normalizeName(record.facilityName);
  const category = normalizeName(record.category);
  return facility ? facility + "|" + category : normalizeRegistrationNumber(record.hefamaaId);
}

export function latestDistinctFacilityRecords(records: StaffIndexRecord[]) {
  const bestByFacility = new Map<string, StaffIndexRecord>();
  for (const record of records) {
    const key = distinctFacilityKey(record);
    if (!key) continue;
    const existing = bestByFacility.get(key);
    if (!existing || recencyScore(record) > recencyScore(existing)) {
      bestByFacility.set(key, record);
    }
  }
  return Array.from(bestByFacility.values()).sort((a, b) => cleanText(a.facilityName).localeCompare(cleanText(b.facilityName)));
}

function uniqueRegistrationNumbers(records: StaffIndexRecord[]) {
  return Array.from(new Set(records.map((record) => record.registrationNumber).map(cleanText).filter(Boolean)));
}

function uniqueProfessions(records: StaffIndexRecord[]) {
  return Array.from(new Set(records.map((record) => record.profession).map(cleanText).filter(Boolean)));
}

function listFacilities(records: StaffIndexRecord[], max = 8) {
  const names = records.slice(0, max).map((record) => {
    const suffix = [record.category, record.renewalYear ? "latest portal year " + record.renewalYear : ""].filter(Boolean).join(", " );
    return record.facilityName + (suffix ? " (" + suffix + ")" : "");
  });
  if (!names.length) return "";
  const extra = records.length > max ? " and " + (records.length - max).toLocaleString() + " more" : "";
  return names.join("; " ) + extra;
}

function asksForFacilityAppearance(question: string) {
  return /how\s+many\s+facilit(?:y|ies)|facilit(?:y|ies).*?(?:appear|appearing|working|work|listed)|where\s+(?:is|does)|working\s+presently|work\s+presently/i.test(question);
}

function extractStaffLookupQuery(question: string): string {
  const text = cleanText(question);
  const quoted = text.match(/["'“‘]([^"'”’]{2,})["'”’]/);
  if (quoted?.[1]) return quoted[1];

  const patterns = [
    /how\s+many\s+facilit(?:y|ies).*?(?:is|does|has)?\s*(.+?)\s+(?:appear|appearing|work|working|listed|showing)/i,
    /(?:which|what)\s+facilit(?:y|ies).*?(?:does|is)\s+(.+?)\s+(?:work|appear|appearing)/i,
    /where\s+is\s+(.+?)\s+(?:working|currently|presently|now)/i,
    /where\s+does\s+(.+?)\s+work/i,
    /(?:staff\s+name|professional\s+name|name)\s+(?:is\s+)?(.+?)(?:\?|$)/i,
    /(?:registration\s+number|reg\.?\s*no|license|licence|folio)\s+(?:for|of)?\s*(.+?)(?:\?|$)/i,
    /(?:find|search|check)\s+(?:staff|doctor|nurse|personnel|professional)?\s*(.+?)(?:\?|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanText(match[1]
        .replace(/^(?:is|does|has)\s+/i, "")
        .replace(/\b(presently|currently|now|exist|exists|working|work|appearing|appear|listed|showing|facility|facilities|this\s+name|the\s+name)\b/gi, "")
        .replace(/[?.!]+$/g, ""));
    }
  }

  const registration = extractRegistrationNumber(text);
  if (registration) return registration;

  return "";
}

export function isStaffQuestion(question: string): boolean {
  const explicitStaffContext = /staff\s+name|professional\s+staff|medical\s+professional\s+data|staff\s+exist|where\s+is\s+.+\s+(?:working|work|presently|currently)|where\s+does\s+.+\s+work|working\s+presently|how\s+many\s+facilit(?:y|ies).*?(?:appear|appearing|working|work|listed)|manipulat|same\s+registration/i.test(question);
  const professionalTitleWithPerson = /\b(?:dr|doctor|nurse|pharmacist|radiographer|lab\s*(?:scientist|tech)|physiotherapist|optometrist|dentist)\.?\s+[a-z]/i.test(question) && /where|working|appear|appearing|facilit|registration|reg\.?\s*no|exist/i.test(question);
  const staffLicenceContext = /(?:staff|doctor|nurse|pharmacist|radiographer|lab\s+(?:scientist|tech)|personnel|professional)\b.*\b(?:registration\s+number|reg\.?\s*no|folio|licen[cs]e)/i.test(question);
  const licencePrefixContext = /\b(?:MDCN|MLSCN|NMCN|PCN|RRBN|RADCN|EHORECON|CHPRBN|MRTB|ODORBN|OPTOM|FMLSCN)\b/i.test(question);

  return explicitStaffContext || professionalTitleWithPerson || staffLicenceContext || licencePrefixContext;
}

export function answerStaffQuestion(question: string): StaffQuestionAnswer {
  const records = buildStaffIndex();
  const issues = findStaffIntegrityIssues(records);
  const issueCounts = issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.type] = (acc[issue.type] ?? 0) + 1;
    return acc;
  }, {});

  if (records.length === 0) {
    return {
      answer: "No structured staff-name records have been indexed from the portal cache yet. The current captured portal details include staff complement counts, but not the professional staff rows with names and registration numbers. Run a Full Detail Scan or capture facility detail pages with the Professional Staff section visible, then ask again.",
      summary: { totalStaffRecords: 0, issueCounts, note: "Staff complement counts are available, but staff names are not yet present in the detail cache." },
      rows: [],
    };
  }

  if (/manipulat|duplicate|same\s+registration|integrity|fraud|multiple\s+facilities|several\s+facilities/i.test(question)) {
    const limitedIssues = issues.slice(0, 10);
    const rows = limitedIssues.flatMap((issue) => issue.records.slice(0, 5).map((record) => ({ issue: issue.type, issueSummary: issue.summary, ...publicStaffRow(record) })));
    const answer = issues.length
      ? "I found " + issues.length.toLocaleString() + " staff integrity issue(s) in the indexed portal staff records. I checked repeated registration numbers across names/facilities and staff names appearing with multiple registration numbers."
      : "I did not find staff registration-number integrity issues in the indexed portal staff records.";
    return { answer, summary: { totalStaffRecords: records.length, issueCounts, issueCount: issues.length }, rows };
  }

  const lookupQuery = extractStaffLookupQuery(question);

  if (!lookupQuery || /^(this name|the name|name)$/i.test(lookupQuery)) {
    return {
      answer: "The professional staff index currently contains " + records.length.toLocaleString() + " staff portal record(s). Please include the staff name or registration number, for example: where is Dr. Example working presently?",
      summary: { totalStaffRecords: records.length, issueCounts },
      rows: latestDistinctFacilityRecords(records).slice(0, 15).map(publicStaffRow),
    };
  }

  const matches = searchStaffIntelligence(lookupQuery, records);
  const latestFacilities = latestDistinctFacilityRecords(matches);

  if (matches.length === 0) {
    return {
      answer: "I could not find a medical professional record matching " + lookupQuery + " in the indexed HEFAMAA portal staff cache. Please confirm the spelling or registration number. If the facility has not been captured with its Professional Staff section visible, run a detail capture for that facility and ask again.",
      summary: { totalStaffRecords: records.length, query: lookupQuery, matchCount: 0, distinctFacilityCount: 0, issueCounts },
      rows: [],
    };
  }

  const registrations = uniqueRegistrationNumbers(matches);
  const professions = uniqueProfessions(matches);
  const displayName = matches.find((record) => record.staffName)?.staffName || lookupQuery;
  const facilityText = listFacilities(latestFacilities);
  const answerPrefix = asksForFacilityAppearance(question)
    ? displayName + " appears in " + latestFacilities.length.toLocaleString() + " distinct facilit" + (latestFacilities.length === 1 ? "y" : "ies") + " in the indexed portal staff cache"
    : displayName + " is currently indexed under " + latestFacilities.length.toLocaleString() + " distinct facilit" + (latestFacilities.length === 1 ? "y" : "ies") + " in the portal staff cache";

  const details = [
    answerPrefix,
    "portal year records found: " + matches.length.toLocaleString(),
    professions.length ? "profession(s): " + professions.join(", ") : "",
    registrations.length ? "registration number(s): " + registrations.join(", ") : "",
    facilityText ? "facilities: " + facilityText : "",
  ].filter(Boolean);

  return {
    answer: details.join(". ") + ".",
    summary: {
      totalStaffRecords: records.length,
      query: lookupQuery,
      portalRecordMatches: matches.length,
      distinctFacilityCount: latestFacilities.length,
      registrationNumbers: registrations,
      professions,
      issueCounts,
    },
    rows: latestFacilities.map(publicStaffRow),
  };
}
