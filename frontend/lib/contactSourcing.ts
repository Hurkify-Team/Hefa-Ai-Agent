import { existsSync, readFileSync, writeFileSync } from "fs";

import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";

import { compareFacilitySimilarity, normalizeEmail, normalizeFacilityName, normalizeHeaderName, normalizeLGA, normalizePhoneNumber } from "@/lib/normalizers";
import { readPortalCacheRows, type PortalCacheRow } from "@/lib/portalCacheModel";
import { readPortalDetailsCacheLightweight, type LightweightPortalFacilityDetailRecord } from "@/lib/portalCacheStore";
import { getSourceAllSheetData, isWorkbookSourceConfigured, WORKBOOK_SOURCE_LABELS, type WorkbookSource } from "@/lib/workbookSources";
import type { SheetRow } from "@/types/sheet";

type ContactSourceName = "portal_cache" | "active_sheet" | "old_sheet";

const SOURCE_PRIORITY: Record<ContactSourceName, number> = {
  portal_cache: 3,
  active_sheet: 2,
  old_sheet: 1,
};

type ContactCandidate = {
  category: string;
  contact: string;
  email: string;
  facilityName: string;
  hefNo: string;
  lga: string;
  source: ContactSourceName;
  sourceLabel: string;
};

export type ContactSourceTarget = {
  category?: string | null;
  facilityName?: string | null;
  hefNo?: string | null;
  id?: string | null;
  lga?: string | null;
  missingEmail?: boolean;
  missingPhone?: boolean;
  portalStatus?: string | null;
};

export type ContactSourceUpdate = {
  category: string;
  contact: string;
  email: string;
  facilityName: string;
  hefNo: string;
  matchedCategory: string;
  matchedFacilityName: string;
  matchedHefNo: string;
  score: number;
  source: ContactSourceName;
  sourceLabel: string;
  status: "updated" | "not_found" | "ambiguous" | "skipped";
};

export type ContactSourcingResult = {
  ambiguous: number;
  emailFound: number;
  missingTargets: number;
  notFound: number;
  phoneFound: number;
  scannedTargets: number;
  skipped: number;
  updated: number;
  updates: ContactSourceUpdate[];
};

const FIELD_ALIASES = {
  address: ["Address", "ADDRESS", "Facility Address"],
  category: ["Category", "Facility Category", "FACILITY CATEGORY"],
  contact: ["Contact", "Phone", "Phone Number", "Phone No", "PHONE NO", "Telephone", "Mobile", "Facility Phone"],
  email: ["Facility E-Mail", "Facility Email", "Email", "E-Mail", "E-MAIL"],
  facilityName: ["Facility Name", "FACILITY NAME", "Name", "Name of Facility", "FACILITY", "Facility"],
  hefNo: ["HEF/NO", "HEF NO", "HEFAMAA NO", "HF NO", "REG NO", "Registration Number", "Registration No", "Facility Code", "FACILITY CODE", "FacilityCode", "Code"],
  lga: ["LGA", "Local Government"],
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function localCachePath(envName: string, fallback: string) {
  return configuredRuntimeFile(envName, fallback);
}

function qaIndexPath() {
  return localCachePath("HEFAMAA_PORTAL_QA_INDEX", "data/portal-qa-index.json");
}

function detailsCachePath() {
  return localCachePath("HEFAMAA_PORTAL_DETAILS_CACHE", "data/portal-facility-details-cache.json");
}

function valueFor(row: SheetRow, fields: string[]) {
  const normalizedLookup = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeaderName(key), value] as const),
  );

  for (const field of fields) {
    const directValue = row[field];
    if (directValue !== undefined && directValue !== null && clean(directValue)) return clean(directValue);

    const normalizedValue = normalizedLookup.get(normalizeHeaderName(field));
    if (normalizedValue !== undefined && normalizedValue !== null && clean(normalizedValue)) return clean(normalizedValue);
  }

  return "";
}

function rowValue(row: SheetRow, fields: string[]) {
  return valueFor(row, fields);
}

function validEmail(value: unknown) {
  const email = normalizeEmail(clean(value));
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function validPhone(value: unknown) {
  const phone = normalizePhoneNumber(clean(value));
  return phone.length >= 10 ? phone : "";
}

function emailFromText(text: string) {
  return validEmail((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).at(-1));
}

function linesOf(text: string) {
  return text.split(/\n+/).map(clean).filter(Boolean);
}

function sectionValue(text: string, sectionName: string, labels: string[]) {
  const lines = linesOf(text);
  const sectionToken = normalized(sectionName);
  const start = lines.findIndex((line) => normalized(line) === sectionToken);
  if (start < 0) return "";
  const sectionHeaders = new Set(["facility details", "contact details", "proprietors details", "operations details", "medical professional in charge", "professional staff", "non professional staff", "admin activities", "queries", "documents"].map(normalized));
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (sectionHeaders.has(normalized(lines[index]))) {
      end = index;
      break;
    }
  }
  const labelTokens = labels.map(normalized);
  for (let index = start + 1; index < end; index += 1) {
    if (!labelTokens.includes(normalized(lines[index]))) continue;
    for (let next = index + 1; next < end; next += 1) {
      const candidate = clean(lines[next]);
      if (candidate) return candidate;
    }
  }
  return "";
}

function phoneFromText(text: string) {
  return validPhone(sectionValue(text, "CONTACT DETAILS", ["PHONE NUMBER", "PHONE", "CONTACT"])) || validPhone(text.match(/(?:\+?234|0)\d[\d\s-]{7,}/)?.[0]);
}

function candidateKey(candidate: ContactCandidate) {
  return [candidate.source, candidate.facilityName, candidate.hefNo, candidate.category, candidate.email, candidate.contact].map(normalized).join("|");
}

function pushCandidate(candidates: ContactCandidate[], candidate: ContactCandidate) {
  if (!candidate.facilityName || (!candidate.email && !candidate.contact)) return;
  candidates.push(candidate);
}

function portalRowCandidate(row: PortalCacheRow): ContactCandidate {
  return {
    category: clean(row.category),
    contact: validPhone(row.contact),
    email: validEmail(row.email),
    facilityName: clean(row.facility_name),
    hefNo: clean(row.hef_no),
    lga: clean(row.lga),
    source: "portal_cache",
    sourceLabel: "Portal Detail Cache",
  };
}

function detailCandidate(record: LightweightPortalFacilityDetailRecord): ContactCandidate {
  const fields = record.visibleFields ?? {};
  const text = clean(record.bodyText || record.text);
  const email = validEmail(fields.Email || fields.EMAIL || fields["E-MAIL"] || fields["FACILITY EMAIL"] || fields["Facility E-Mail"]) || validEmail(sectionValue(text, "CONTACT DETAILS", ["EMAIL", "E-MAIL", "FACILITY EMAIL"])) || emailFromText(text);
  const contact = validPhone(fields["PHONE NUMBER"] || fields.Phone || fields.PHONE || fields.Contact || fields.CONTACT) || phoneFromText(text);
  return {
    category: clean(record.category || record.sourceRecord?.category),
    contact,
    email,
    facilityName: clean(record.facilityName || record.sourceRecord?.facilityName),
    hefNo: clean(record.hefamaaId || record.sourceRecord?.hefamaaId),
    lga: clean(fields.LGA || fields.lga),
    source: "portal_cache",
    sourceLabel: "Portal Detail Cache",
  };
}

function sheetCandidate(source: WorkbookSource, category: string, row: SheetRow): ContactCandidate {
  return {
    category: clean(rowValue(row, FIELD_ALIASES.category)) || category,
    contact: validPhone(rowValue(row, FIELD_ALIASES.contact)),
    email: validEmail(rowValue(row, FIELD_ALIASES.email)),
    facilityName: clean(rowValue(row, FIELD_ALIASES.facilityName)),
    hefNo: clean(rowValue(row, FIELD_ALIASES.hefNo)),
    lga: clean(rowValue(row, FIELD_ALIASES.lga)),
    source: source === "active" ? "active_sheet" : "old_sheet",
    sourceLabel: WORKBOOK_SOURCE_LABELS[source],
  };
}

async function buildSheetCandidates(source: WorkbookSource) {
  if (!isWorkbookSourceConfigured(source)) return [];
  try {
    const data = await getSourceAllSheetData(source);
    const candidates: ContactCandidate[] = [];
    for (const [category, sheet] of Object.entries(data)) {
      for (const row of sheet.rows) pushCandidate(candidates, sheetCandidate(source, category, row));
    }
    return candidates;
  } catch (error) {
    console.warn("Contact sourcing skipped " + source + " workbook:", error instanceof Error ? error.message : error);
    return [];
  }
}

async function buildCandidates(options: { includeSheets?: boolean } = {}) {
  const candidates: ContactCandidate[] = [];
  for (const row of readPortalCacheRows()) pushCandidate(candidates, portalRowCandidate(row));
  for (const record of readPortalDetailsCacheLightweight()) pushCandidate(candidates, detailCandidate(record));

  if (options.includeSheets) {
    candidates.push(...await buildSheetCandidates("active"));
    candidates.push(...await buildSheetCandidates("old"));
  }

  const deduped = new Map<string, ContactCandidate>();
  for (const candidate of candidates) deduped.set(candidateKey(candidate), candidate);
  return [...deduped.values()];
}

function compatibleText(actual: string, expected: string) {
  const a = normalized(actual);
  const e = normalized(expected);
  return Boolean(!a || !e || a === e || a.includes(e) || e.includes(a));
}

function candidateScore(target: ContactSourceTarget, candidate: ContactCandidate) {
  const targetName = clean(target.facilityName);
  const candidateName = clean(candidate.facilityName);
  const targetHef = normalized(target.hefNo);
  const candidateHef = normalized(candidate.hefNo);
  const nameSimilarity = compareFacilitySimilarity(targetName, candidateName);
  let score = 0;

  if (targetHef && candidateHef && targetHef === candidateHef) score += 120;
  if (normalizeFacilityName(targetName) && normalizeFacilityName(targetName) === normalizeFacilityName(candidateName)) score += 100;
  else if (nameSimilarity >= 0.96) score += 86;
  else if (nameSimilarity >= 0.92) score += 74;

  if (!score) return 0;

  if (target.category && candidate.category && compatibleText(candidate.category, target.category)) score += 12;
  if (target.lga && candidate.lga && normalizeLGA(candidate.lga) === normalizeLGA(target.lga)) score += 8;
  if (candidate.email) score += 3;
  if (candidate.contact) score += 3;

  if (!targetHef && target.category && candidate.category && !compatibleText(candidate.category, target.category) && nameSimilarity < 0.99) return 0;
  return score;
}

function bestCandidate(target: ContactSourceTarget, candidates: ContactCandidate[]) {
  const wantsEmail = target.missingEmail !== false;
  const wantsPhone = target.missingPhone !== false;
  const scored = candidates
    .filter((candidate) => (wantsEmail && candidate.email) || (wantsPhone && candidate.contact))
    .map((candidate) => ({ candidate, score: candidateScore(target, candidate) }))
    .filter((item) => item.score >= 88)
    .sort((a, b) => b.score - a.score || SOURCE_PRIORITY[b.candidate.source] - SOURCE_PRIORITY[a.candidate.source]);

  const top = scored[0];
  if (!top) return { status: "not_found" as const };

  const second = scored[1];
  const exactTopName = normalizeFacilityName(top.candidate.facilityName) === normalizeFacilityName(target.facilityName);
  const conflictingCloseMatch = !exactTopName
    && second
    && top.score - second.score <= 4
    && SOURCE_PRIORITY[top.candidate.source] === SOURCE_PRIORITY[second.candidate.source]
    && (
      (top.candidate.email && second.candidate.email && top.candidate.email !== second.candidate.email) ||
      (top.candidate.contact && second.candidate.contact && top.candidate.contact !== second.candidate.contact)
    );

  if (conflictingCloseMatch) return { status: "ambiguous" as const, score: top.score };
  return { candidate: top.candidate, score: top.score, status: "updated" as const };
}

type QaIndexRecord = Record<string, unknown> & { facilityName?: string; hefamaaId?: string; category?: string; qaFields?: Record<string, string>; visibleFields?: Record<string, string> };
type QaIndexFile = { records?: QaIndexRecord[]; sourceMtimeMs?: number; version?: number };

function readQaIndexFile(): QaIndexFile {
  const file = qaIndexPath();
  if (!existsSync(file)) return { records: [], version: 1 };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { ...parsed, records: Array.isArray(parsed.records) ? parsed.records : [] };
  } catch {
    return { records: [], version: 1 };
  }
}

function readDetailsCacheFile() {
  const file = detailsCachePath();
  if (!existsSync(file)) return [] as Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
  } catch {
    return [] as Array<Record<string, unknown>>;
  }
}

function matchesRecord(record: { facilityName?: unknown; hefamaaId?: unknown; category?: unknown }, target: ContactSourceTarget) {
  const targetHef = normalized(target.hefNo);
  const recordHef = normalized(record.hefamaaId);
  if (targetHef && recordHef && targetHef === recordHef) return true;
  if (!targetHef && recordHef) return false;
  if (normalizeFacilityName(record.facilityName as string) !== normalizeFacilityName(target.facilityName)) return false;
  return compatibleText(clean(record.category), clean(target.category));
}

function applyFields(record: Record<string, unknown>, update: ContactSourceUpdate, now: string, target?: ContactSourceTarget) {
  const qaFields = { ...((record.qaFields as Record<string, string> | undefined) ?? {}) };
  const visibleFields = { ...((record.visibleFields as Record<string, string> | undefined) ?? {}) };

  if (update.email) {
    qaFields.email = update.email;
    visibleFields.Email = update.email;
    visibleFields["E-MAIL"] = update.email;
  }
  if (update.contact) {
    qaFields.contact_phone = update.contact;
    visibleFields["PHONE NUMBER"] = update.contact;
    visibleFields.Contact = update.contact;
  }
  if (target?.portalStatus) {
    qaFields.status = clean(target.portalStatus);
    visibleFields["REG. STATUS"] = clean(target.portalStatus);
    record.registrationStatus = clean(target.portalStatus);
  }

  record.qaFields = qaFields;
  record.visibleFields = visibleFields;
  record.contactSourcedAt = now;
  record.contactSource = update.sourceLabel;
  record.contactSourceScore = update.score;

  const bodyText = clean(record.bodyText || record.text);
  const sourcedText = [
    "CONTACT DETAILS",
    update.contact ? "PHONE NUMBER\n" + update.contact : "",
    update.email ? "EMAIL\n" + update.email : "",
  ].filter(Boolean).join("\n");
  if (sourcedText && !bodyText.includes(sourcedText)) record.bodyText = bodyText ? bodyText + "\n" + sourcedText : sourcedText;
}

function writeJson(file: string, value: unknown) {
  ensureRuntimeDataDirForFile(file);
  writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function persistUpdates(targets: ContactSourceTarget[], updates: ContactSourceUpdate[]) {
  const successful = updates.filter((update) => update.status === "updated");
  if (!successful.length) return;

  const now = new Date().toISOString();
  const qaFile = readQaIndexFile();
  const qaRecords = qaFile.records ?? [];
  const detailRecords = readDetailsCacheFile();

  for (const update of successful) {
    const target = targets.find((item) => normalizeFacilityName(item.facilityName) === normalizeFacilityName(update.facilityName) && compatibleText(clean(item.category), update.category));
    const lookupTarget = target ?? { category: update.category, facilityName: update.facilityName, hefNo: update.hefNo };

    let qaRecord = qaRecords.find((record) => matchesRecord(record, lookupTarget));
    if (!qaRecord) {
      qaRecord = {
        applicationType: "contact_sourced",
        cacheKey: [update.hefNo, update.facilityName, update.category].map(normalized).join("|"),
        capturedAt: now,
        category: update.category,
        facilityName: update.facilityName,
        hefamaaId: update.hefNo,
        normalizedStatus: "contact_sourced",
        qaFields: {},
        qaIndexVersion: 1,
        visibleFields: {},
      };
      qaRecords.push(qaRecord);
    }
    applyFields(qaRecord, update, now, lookupTarget);

    let detailRecord = detailRecords.find((record) => matchesRecord(record, lookupTarget));
    if (!detailRecord) {
      detailRecord = {
        applicationType: "contact_sourced",
        capturedAt: now,
        category: update.category,
        facilityName: update.facilityName,
        hefamaaId: update.hefNo,
        visibleFields: {},
      };
      detailRecords.push(detailRecord);
    }
    applyFields(detailRecord, update, now, lookupTarget);
  }

  writeJson(qaIndexPath(), { ...qaFile, records: qaRecords, version: qaFile.version ?? 1 });
  writeJson(detailsCachePath(), detailRecords);
}

export async function sourceMissingPortalContacts(targets: ContactSourceTarget[], options: { includeSheets?: boolean } = {}): Promise<ContactSourcingResult> {
  const missingTargets = targets.filter((target) => clean(target.facilityName) && (target.missingEmail || target.missingPhone));
  const candidates = await buildCandidates(options);
  const updates: ContactSourceUpdate[] = [];

  for (const target of missingTargets) {
    const best = bestCandidate(target, candidates);
    const base = {
      category: clean(target.category),
      contact: "",
      email: "",
      facilityName: clean(target.facilityName),
      hefNo: clean(target.hefNo),
      matchedCategory: "",
      matchedFacilityName: "",
      matchedHefNo: "",
      score: "score" in best ? best.score ?? 0 : 0,
      source: "portal_cache" as ContactSourceName,
      sourceLabel: "Not found",
    };

    if (best.status !== "updated" || !best.candidate) {
      updates.push({ ...base, status: best.status });
      continue;
    }

    const email = target.missingEmail ? best.candidate.email : "";
    const contact = target.missingPhone ? best.candidate.contact : "";
    if (!email && !contact) {
      updates.push({ ...base, status: "skipped" });
      continue;
    }

    updates.push({
      ...base,
      category: clean(target.category) || best.candidate.category,
      contact,
      email,
      hefNo: clean(target.hefNo),
      matchedCategory: best.candidate.category,
      matchedFacilityName: best.candidate.facilityName,
      matchedHefNo: best.candidate.hefNo,
      score: best.score,
      source: best.candidate.source,
      sourceLabel: best.candidate.sourceLabel,
      status: "updated",
    });
  }

  persistUpdates(missingTargets, updates);

  return {
    ambiguous: updates.filter((update) => update.status === "ambiguous").length,
    emailFound: updates.filter((update) => update.status === "updated" && update.email).length,
    missingTargets: missingTargets.length,
    notFound: updates.filter((update) => update.status === "not_found").length,
    phoneFound: updates.filter((update) => update.status === "updated" && update.contact).length,
    scannedTargets: targets.length,
    skipped: updates.filter((update) => update.status === "skipped").length,
    updated: updates.filter((update) => update.status === "updated").length,
    updates: updates.slice(0, 100),
  };
}
