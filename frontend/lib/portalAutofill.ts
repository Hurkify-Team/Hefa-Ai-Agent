import { filterPortalFacilityRecords, latestPortalFacilities } from "@/lib/portalIntelligence";
import { normalizeFacilityName, normalizeHeaderName } from "@/lib/normalizers";
import { readSheetHeaders, readSheetTabs } from "@/lib/googleSheets";
import type { PortalFacilityRecord } from "@/lib/playwrightPortal";
import type { SheetRow, SheetRowValue } from "@/types/sheet";

export type PortalAutofillResult = {
  query: string;
  targetCategory: string;
  portalCategory: string;
  headers: string[];
  values: SheetRow;
  filledFields: string[];
  missingFields: string[];
  confidence: number;
  selectedRecord: PortalFacilityRecord;
  matches: PortalFacilityRecord[];
  notes: string[];
};

const HEF_NO_HEADERS = ["hef/no", "hef no", "hefamaa no", "hefamaa number", "registration number", "registration no"];

const FIELD_ALIASES: Record<string, string[]> = {
  facilityName: ["facility name", "name of facility", "facility", "name"],
  address: ["address", "facility address", "location", "premises address", "operational address"],
  lga: ["lga", "local government", "local government area"],
  lcda: ["lcda"],
  email: ["facility e-mail", "facility email", "email", "e-mail"],
  ownerName: ["owner's name", "owner name", "proprietor", "proprietor name", "director name"],
  ownerAddress: ["owner's address", "owner address", "proprietor address"],
  contact: ["contact", "phone", "phone number", "telephone", "mobile"],
  scope: ["scope of service", "services", "service", "scope"],
  status: ["status", "registration status", "facility status"],
  category: ["category", "facility category", "facility type", "type"],
  dateRegistered: ["date registered", "registration date", "date of registration", "record date"],
  renewalYear: ["renewal year", "year"],
  portalId: ["portal id", "e-hefamaa", "e-hefamaa id", "application id", "portal number"],
  doctors: ["doctor", "doctors", "no of doctors", "medical doctor"],
  nurses: ["nurse", "nurses", "no of nurses"],
  pharmacist: ["pharmacist", "pharmacists"],
  labScientist: ["lab sci", "lab scientist", "laboratory scientist", "medical record / lab sci"],
  labTechnician: ["lab tech", "lab technician", "laboratory technician"],
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function token(value: unknown) {
  return normalizeFacilityName(clean(value));
}

function normalizedCategory(value: unknown) {
  return token(value).replace(/\b(?:centre|center|home|clinic|hospital|facility)\b/g, " ").replace(/\s+/g, " ").trim();
}

function categoryScore(tabTitle: string, portalCategory: string, requestedCategory?: string) {
  const tab = normalizedCategory(tabTitle);
  const portal = normalizedCategory(portalCategory);
  const requested = normalizedCategory(requestedCategory ?? "");
  let score = 0;

  if (requested && token(tabTitle) === token(requestedCategory)) score += 90;
  if (portal && token(tabTitle) === token(portalCategory)) score += 120;
  if (portal && (tab.includes(portal) || portal.includes(tab))) score += 70;
  if (requested && (tab.includes(requested) || requested.includes(tab))) score += 40;

  const tabTokens = new Set(tab.split(" ").filter(Boolean));
  for (const item of [portal, requested]) {
    if (!item) continue;
    const hits = item.split(" ").filter((part) => tabTokens.has(part)).length;
    score += hits * 12;
  }

  return score;
}

async function resolveTargetCategory(record: PortalFacilityRecord, requestedCategory?: string) {
  const tabs = await readSheetTabs();
  const ranked = tabs
    .map((tab) => ({ tab, score: categoryScore(tab.title, record.category, requestedCategory) }))
    .sort((a, b) => b.score - a.score || a.tab.title.localeCompare(b.tab.title));

  if (ranked[0]?.score > 0) return ranked[0].tab.title;
  if (requestedCategory) return requestedCategory;
  return record.category;
}

function visibleValue(record: PortalFacilityRecord, aliases: string[]) {
  const fields = record.visibleFields ?? {};
  const normalizedAliases = aliases.map(normalizeHeaderName);

  for (const [header, value] of Object.entries(fields)) {
    const normalizedHeader = normalizeHeaderName(header);
    if (normalizedAliases.some((alias) => normalizedHeader === alias || normalizedHeader.includes(alias) || alias.includes(normalizedHeader))) {
      const found = clean(value);
      if (found) return found;
    }
  }

  return "";
}

function visibleHeaderValue(record: PortalFacilityRecord, header: string) {
  const normalizedTarget = normalizeHeaderName(header);
  const fields = record.visibleFields ?? {};

  for (const [field, value] of Object.entries(fields)) {
    const normalizedField = normalizeHeaderName(field);
    const cleanValue = clean(value);
    if (!cleanValue) continue;
    if (normalizedField === normalizedTarget) return cleanValue;
  }

  for (const [field, value] of Object.entries(fields)) {
    const normalizedField = normalizeHeaderName(field);
    const cleanValue = clean(value);
    if (!cleanValue) continue;
    if (normalizedField.includes(normalizedTarget) || normalizedTarget.includes(normalizedField)) return cleanValue;
  }

  return "";
}

function isHefNoHeader(header: string) {
  const normalized = normalizeHeaderName(header);
  return HEF_NO_HEADERS.some((candidate) => normalized === normalizeHeaderName(candidate));
}

function aliasValue(record: PortalFacilityRecord, aliasKey: keyof typeof FIELD_ALIASES) {
  return visibleValue(record, FIELD_ALIASES[aliasKey]);
}

function mappedValueForHeader(record: PortalFacilityRecord, header: string): SheetRowValue {
  const normalized = normalizeHeaderName(header);
  const direct = visibleHeaderValue(record, header);

  if (isHefNoHeader(header)) {
    return visibleValue(record, ["HEF/NO", "HEF NO", "HEFAMAA NO", "Registration Number", "Registration No"]) || null;
  }

  if (direct) return direct;

  if (FIELD_ALIASES.facilityName.map(normalizeHeaderName).includes(normalized)) return clean(record.facilityName) || null;
  if (FIELD_ALIASES.category.map(normalizeHeaderName).includes(normalized)) return clean(record.category) || null;
  if (FIELD_ALIASES.portalId.map(normalizeHeaderName).includes(normalized)) return clean(record.hefamaaId) || null;
  if (FIELD_ALIASES.status.map(normalizeHeaderName).includes(normalized)) return clean(record.registrationStatus || record.normalizedStatus) || null;
  if (FIELD_ALIASES.renewalYear.map(normalizeHeaderName).includes(normalized)) return record.renewalYear ?? null;
  if (FIELD_ALIASES.dateRegistered.map(normalizeHeaderName).includes(normalized)) return clean(record.recordDate) || null;

  const aliasChecks: Array<keyof typeof FIELD_ALIASES> = [
    "address",
    "lga",
    "lcda",
    "email",
    "ownerName",
    "ownerAddress",
    "contact",
    "scope",
    "doctors",
    "nurses",
    "pharmacist",
    "labScientist",
    "labTechnician",
  ];

  for (const key of aliasChecks) {
    if (FIELD_ALIASES[key].some((alias) => normalized.includes(normalizeHeaderName(alias)) || normalizeHeaderName(alias).includes(normalized))) {
      const value = aliasValue(record, key);
      if (value) return value;
    }
  }

  return null;
}

function recordScore(record: PortalFacilityRecord, query: string, requestedCategory?: string) {
  const cleanQuery = token(query);
  const name = token(record.facilityName);
  const text = token([record.facilityName, record.hefamaaId, record.category, record.text].join(" "));
  let score = 0;

  if (cleanQuery && name === cleanQuery) score += 100;
  else if (cleanQuery && name.includes(cleanQuery)) score += 75;
  else if (cleanQuery && text.includes(cleanQuery)) score += 45;

  if (cleanQuery && score === 0) return 0;

  if (record.renewalYear === Number(process.env.HEFAMAA_CURRENT_RENEWAL_YEAR || new Date().getFullYear())) score += 20;
  if (/approved|active|current/i.test(record.registrationStatus)) score += 12;
  if (requestedCategory && categoryScore(requestedCategory, record.category, requestedCategory) > 0) score += 8;
  if (record.visibleFields?.["Detail Captured At"]) score += 8;

  return score;
}

function bestPortalRecords(query: string, requestedCategory?: string) {
  const initial = filterPortalFacilityRecords({ query, category: requestedCategory, limit: 80 }).records;
  const fallback = initial.length ? initial : filterPortalFacilityRecords({ query, limit: 80 }).records;
  const latest = fallback.length ? latestPortalFacilities(fallback) : [];
  const candidates = latest.length ? latest : fallback;

  return candidates
    .map((record) => ({ record, score: recordScore(record, query, requestedCategory) }))
    .filter((entry) => entry.score > 0 || !query)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.record);
}

export async function buildPortalAutofill(input: { category?: string; query: string }): Promise<PortalAutofillResult> {
  const query = input.query.trim();
  if (!query) throw new Error("Facility name or portal search query is required.");

  const matches = bestPortalRecords(query, input.category).slice(0, 10);
  const selectedRecord = matches[0];
  if (!selectedRecord) {
    throw new Error("No matching facility was found in the portal cache. Run Quick Scan, then try the portal autofill again.");
  }

  const targetCategory = await resolveTargetCategory(selectedRecord, input.category);
  const headerResult = await readSheetHeaders(targetCategory);
  const values = Object.fromEntries(
    headerResult.headers.map((header) => [header, mappedValueForHeader(selectedRecord, header)]),
  ) as SheetRow;
  const filledFields = headerResult.headers.filter((header) => values[header] !== null && values[header] !== undefined && clean(values[header] ?? ""));
  const missingFields = headerResult.headers.filter((header) => !filledFields.includes(header));
  const confidence = headerResult.headers.length ? filledFields.length / headerResult.headers.length : 0;
  const notes = [
    "Portal cache category was " + (selectedRecord.category || "not visible") + ". Target sheet resolved to " + headerResult.category + ".",
    isHefNoHeader(headerResult.headers.find(isHefNoHeader) ?? "") && !values[headerResult.headers.find(isHefNoHeader) ?? ""]
      ? "HEF/NO was left blank because portal E-HEFAMAA ID is not the official workbook HEF/NO."
      : "Only visible portal cache values were used.",
    selectedRecord.visibleFields?.["Detail Captured At"]
      ? "Detailed portal cache was available for this record."
      : "Only list-level portal cache was available; run Full Detail Scan for more fields.",
  ];

  return {
    query,
    targetCategory: headerResult.category,
    portalCategory: selectedRecord.category,
    headers: headerResult.headers,
    values,
    filledFields,
    missingFields,
    confidence,
    selectedRecord,
    matches,
    notes,
  };
}
