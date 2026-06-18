import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";

import {
  readPortalDetailsCacheLightweight,
  readPortalListCacheLightweight,
  type LightweightPortalFacilityDetailRecord,
  type LightweightPortalFacilityRecord,
} from "@/lib/portalCacheStore";

export type PortalCacheQuestionAnswer = {
  answer: string;
  record?: Record<string, unknown>;
  rows?: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
};

type FieldIntent =
  | "address"
  | "ambulance"
  | "cac_number"
  | "category"
  | "closing_time"
  | "contact_phone"
  | "email"
  | "emergency"
  | "establishment_date"
  | "lga"
  | "lcda"
  | "medical_in_charge"
  | "medical_in_charge_reg_no"
  | "opening_time"
  | "owner"
  | "owner_address"
  | "scope_of_service"
  | "staff_complement"
  | "status";

type FieldDefinition = {
  displayName: string;
  intent: FieldIntent;
};

type QaIndexedDetail = LightweightPortalFacilityDetailRecord & {
  qaFields?: Partial<Record<FieldIntent, string>>;
  qaIndexVersion?: number;
  qaSearchText?: string;
};

type PortalQaIndexFile = {
  generatedAt: string;
  records: QaIndexedDetail[];
  sourceMtimeMs: number;
  version: number;
};

const QA_INDEX_VERSION = 1;
let qaIndexCache: { indexMtimeMs: number; records: QaIndexedDetail[]; sourceMtimeMs: number } | null = null;

const FIELD_DEFINITIONS: FieldDefinition[] = [
  { intent: "medical_in_charge_reg_no", displayName: "medical professional in-charge registration number" },
  { intent: "medical_in_charge", displayName: "medical professional in-charge / operating officer" },
  { intent: "owner_address", displayName: "proprietor address" },
  { intent: "owner", displayName: "proprietor / owner" },
  { intent: "address", displayName: "facility address" },
  { intent: "contact_phone", displayName: "phone number" },
  { intent: "email", displayName: "email address" },
  { intent: "status", displayName: "portal status" },
  { intent: "category", displayName: "facility category" },
  { intent: "lga", displayName: "LGA" },
  { intent: "lcda", displayName: "LCDA" },
  { intent: "scope_of_service", displayName: "scope of service" },
  { intent: "staff_complement", displayName: "professional staff complement" },
  { intent: "opening_time", displayName: "opening time" },
  { intent: "closing_time", displayName: "closing time" },
  { intent: "establishment_date", displayName: "date of establishment" },
  { intent: "ambulance", displayName: "ambulance service" },
  { intent: "emergency", displayName: "emergency service" },
  { intent: "cac_number", displayName: "CAC number" },
];

const GENERAL_QUERY_WORDS = new Set([
  "a",
  "an",
  "and",
  "any",
  "about",
  "can",
  "check",
  "could",
  "do",
  "does",
  "facility",
  "find",
  "for",
  "from",
  "give",
  "how",
  "i",
  "in",
  "info",
  "information",
  "is",
  "kindly",
  "me",
  "of",
  "on",
  "please",
  "provide",
  "record",
  "show",
  "tell",
  "the",
  "this",
  "to",
  "what",
  "where",
  "which",
  "who",
]);

const INTENT_QUERY_WORDS: Record<FieldIntent, string[]> = {
  address: ["address", "location", "located", "where"],
  ambulance: ["ambulance", "service"],
  cac_number: ["cac", "number", "registration"],
  category: ["category", "type"],
  closing_time: ["closing", "close", "time"],
  contact_phone: ["phone", "contact", "telephone", "mobile", "number"],
  email: ["email", "mail", "e"],
  emergency: ["emergency", "service"],
  establishment_date: ["establishment", "established", "date"],
  lga: ["lga", "local", "government"],
  lcda: ["lcda"],
  medical_in_charge: ["medical", "professional", "in", "charge", "operating", "officer"],
  medical_in_charge_reg_no: ["medical", "professional", "in", "charge", "operating", "officer", "registration", "reg", "number", "no"],
  opening_time: ["opening", "open", "time"],
  owner: ["owner", "proprietor"],
  owner_address: ["owner", "proprietor", "address", "location"],
  scope_of_service: ["scope", "service", "services"],
  staff_complement: ["staff", "doctor", "doctors", "nurse", "nurses", "complement", "available"],
  status: ["status", "stage", "workflow"],
};

const SECTION_HEADERS = [
  "FACILITY DETAILS",
  "CONTACT DETAILS",
  "PROPRIETORS DETAILS",
  "OPERATIONS DETAILS",
  "BED DISTRIBUTION",
  "SOURCES WATER AND ENERGY",
  "METHODS OF WASTE DISPOSAL",
  "BASIC PROTECTIVE ITEMS",
  "MEDICAL PROFESSIONAL IN-CHARGE",
  "QUALIFICATION OF MEDICAL PROFESSIONAL IN-CHARGE",
  "DOCUMENTS",
  "INTEREST IN OTHER HEALTH FACILITIES",
  "PROFESSIONAL STAFF",
  "NON-PROFESSIONAL STAFF",
  "ADMIN ACTIVITIES",
  "QUERIES",
];

const detailLinesCache = new WeakMap<object, string[]>();
const fieldValueCache = new WeakMap<object, Map<FieldIntent, string>>();

const STATUS_LABELS: Record<string, string> = {
  document_queried: "Document queried",
  document_approved_inspection_pending: "Document approved and inspection report pending",
  final_approval_pending: "Final approval pending",
  inspection_report_pending_approval: "Inspection report upload pending approval",
  payment_approved_pending_document_approval: "Payment approved and pending document approval",
  registration_approved: "Registration approved",
  upload_payment_pending_document_approval: "Upload payment and pending document approval",
  unknown_status: "Unknown status",
};

function cleanText(value: unknown) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function cleanInline(value: unknown) {
  return cleanText(value).replace(/\s+/g, " ").trim();
}

function normalizeToken(value: unknown) {
  return cleanInline(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeLoose(value: unknown) {
  return cleanInline(value).toLowerCase();
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

function portalDetailsPath() {
  return localCachePath("HEFAMAA_PORTAL_DETAILS_CACHE", "data/portal-facility-details-cache.json");
}

function detailLines(detail: LightweightPortalFacilityDetailRecord) {
  const cached = detailLinesCache.get(detail as object);
  if (cached) return cached;

  const text = cleanText(detail.bodyText || detail.text).replace(/^VISIBLE PAGE TEXT:\s*/i, "");
  const lines = text.split("\n").map(cleanInline).filter(Boolean);
  detailLinesCache.set(detail as object, lines);
  return lines;
}

function sectionBounds(lines: string[], aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeToken);
  const start = lines.findIndex((line) => normalizedAliases.some((alias) => normalizeToken(line) === alias));
  if (start < 0) return null;

  const sectionHeaderTokens = SECTION_HEADERS.map(normalizeToken).filter(Boolean);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const token = normalizeToken(lines[index]);
    if (sectionHeaderTokens.includes(token)) {
      end = index;
      break;
    }
  }

  return { end, start };
}

function isLikelyEmptyOrAction(value: string) {
  return !value || /^(download|print facility information|close|view|edit|save|active)$/i.test(value);
}

function valueAfterLabel(lines: string[], aliases: string[], start = 0, end = lines.length) {
  const normalizedAliases = aliases.map(normalizeToken);
  for (let index = start; index < end; index += 1) {
    const token = normalizeToken(lines[index]);
    const matched = normalizedAliases.some((alias) => token === alias);
    if (!matched) continue;

    for (let next = index + 1; next < end; next += 1) {
      const candidate = cleanInline(lines[next]);
      if (isLikelyEmptyOrAction(candidate)) continue;
      return candidate;
    }
  }

  return "";
}

function sectionValue(detail: LightweightPortalFacilityDetailRecord, sectionAliases: string[], labelAliases: string[]) {
  const lines = detailLines(detail);
  const bounds = sectionBounds(lines, sectionAliases);
  if (!bounds) return "";
  return valueAfterLabel(lines, labelAliases, bounds.start + 1, bounds.end);
}

function globalValue(detail: LightweightPortalFacilityDetailRecord, aliases: string[]) {
  const fields = detail.visibleFields ?? {};
  const normalizedAliases = aliases.map(normalizeToken);

  for (const [header, value] of Object.entries(fields)) {
    const headerToken = normalizeToken(header);
    if (normalizedAliases.some((alias) => headerToken === alias || headerToken.includes(alias))) {
      const fieldValue = cleanInline(value);
      if (fieldValue) return fieldValue;
    }
  }

  return valueAfterLabel(detailLines(detail), aliases);
}

function emailsFromDetail(detail: LightweightPortalFacilityDetailRecord) {
  const matches = cleanText(detail.bodyText || detail.text).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return Array.from(new Set(matches.map((value) => value.toLowerCase())));
}

function phoneFromDetail(detail: LightweightPortalFacilityDetailRecord) {
  const contactPhone = sectionValue(detail, ["CONTACT DETAILS"], ["PHONE NUMBER", "PHONE", "CONTACT"]);
  if (contactPhone) return contactPhone;

  const match = cleanText(detail.bodyText || detail.text).match(/(?:\+?234|0)\d[\d\s-]{7,}/);
  return cleanInline(match?.[0] ?? "");
}

function statusLabel(value: string) {
  return STATUS_LABELS[value] ?? value.replace(/_/g, " ");
}

function fieldValueForIntent(detail: LightweightPortalFacilityDetailRecord, intent: FieldIntent) {
  const indexedFields = (detail as QaIndexedDetail).qaFields;
  if (indexedFields && Object.prototype.hasOwnProperty.call(indexedFields, intent)) {
    return cleanInline(indexedFields[intent]);
  }

  let cached = fieldValueCache.get(detail as object);
  if (!cached) {
    cached = new Map<FieldIntent, string>();
    fieldValueCache.set(detail as object, cached);
  }
  if (cached.has(intent)) return cached.get(intent) ?? "";

  let value = "";
  switch (intent) {
    case "address":
      value = sectionValue(detail, ["CONTACT DETAILS"], ["ADDRESS", "FACILITY ADDRESS"])
        || globalValue(detail, ["ADDRESS", "FACILITY ADDRESS"]);
      break;
    case "ambulance":
      value = sectionValue(detail, ["OPERATIONS DETAILS"], ["AMBULANCE SERVICES?"]);
      break;
    case "cac_number":
      value = sectionValue(detail, ["FACILITY DETAILS"], ["CAC NUMBER", "CAC"]);
      break;
    case "category":
      value = cleanInline(detail.category) || sectionValue(detail, ["FACILITY DETAILS"], ["FACILITY CATEGORY", "CATEGORY"]);
      break;
    case "closing_time":
      value = sectionValue(detail, ["OPERATIONS DETAILS"], ["CLOSING TIME"]);
      break;
    case "contact_phone":
      value = phoneFromDetail(detail);
      break;
    case "email": {
      const emails = emailsFromDetail(detail);
      value = emails[emails.length - 1] ?? "";
      break;
    }
    case "emergency":
      value = sectionValue(detail, ["OPERATIONS DETAILS"], ["EMERGENCY SERVICES?"]);
      break;
    case "establishment_date":
      value = sectionValue(detail, ["OPERATIONS DETAILS"], ["DATE OF ESTABLISHMENT"]);
      break;
    case "lga":
      value = sectionValue(detail, ["CONTACT DETAILS"], ["LGA", "LOCAL GOVERNMENT"])
        || globalValue(detail, ["LGA", "LOCAL GOVERNMENT"]);
      break;
    case "lcda":
      value = sectionValue(detail, ["CONTACT DETAILS"], ["LCDA"])
        || globalValue(detail, ["LCDA"]);
      break;
    case "medical_in_charge":
      value = sectionValue(detail, ["MEDICAL PROFESSIONAL IN-CHARGE"], ["FULL NAME", "NAME"]);
      break;
    case "medical_in_charge_reg_no":
      value = sectionValue(detail, ["QUALIFICATION OF MEDICAL PROFESSIONAL IN-CHARGE"], ["REG NO.", "REG NO", "REG. NUMBER", "REGISTRATION NUMBER"]);
      break;
    case "opening_time":
      value = sectionValue(detail, ["OPERATIONS DETAILS"], ["OPENING TIME"]);
      break;
    case "owner":
      value = sectionValue(detail, ["PROPRIETORS DETAILS", "PROPRIETOR DETAILS"], ["NAME", "OWNER NAME", "PROPRIETOR NAME"])
        || globalValue(detail, ["OWNER'S NAME", "OWNER NAME", "PROPRIETOR"]);
      break;
    case "owner_address":
      value = sectionValue(detail, ["PROPRIETORS DETAILS", "PROPRIETOR DETAILS"], ["ADDRESS", "OWNER ADDRESS", "PROPRIETOR ADDRESS"]);
      break;
    case "scope_of_service":
      value = sectionValue(detail, ["OPERATIONS DETAILS"], ["SCOPE OF THE SERVICES IN THE FACILITY", "SCOPE OF SERVICE", "SERVICES"]);
      break;
    case "staff_complement":
      value = staffComplementAnswer(detail);
      break;
    case "status":
      value = cleanInline(detail.registrationStatus) || statusLabel(cleanInline(detail.normalizedStatus));
      break;
    default:
      value = "";
      break;
  }

  cached.set(intent, value);
  return value;
}

function inferIntent(question: string): FieldDefinition | null {
  const text = normalizeLoose(question);
  const token = normalizeToken(question);

  if (/\b(reg(?:istration)?\.?\s*(?:no|number)|license|licence|folio)\b/.test(text) && /\b(officer|professional|in charge|medical)\b/.test(text)) {
    return FIELD_DEFINITIONS.find((field) => field.intent === "medical_in_charge_reg_no") ?? null;
  }
  if (/\b(operating|operation|operations)\s+(officer|manager|lead|head)\b|\bofficer\s+in\s+charge\b|\bmedical\s+professional\s+in\s+charge\b|\bprofessional\s+in\s+charge\b|\bperson\s+in\s+charge\b/.test(text)) {
    return FIELD_DEFINITIONS.find((field) => field.intent === "medical_in_charge") ?? null;
  }
  if (/\b(owner|proprietor)\b/.test(text) && /\baddress\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "owner_address") ?? null;
  if (/\b(owner|proprietor)\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "owner") ?? null;
  if (/\b(address|located|location)\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "address") ?? null;
  if (/\b(phone|contact|telephone|mobile)\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "contact_phone") ?? null;
  if (/\b(email|e mail|mail)\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "email") ?? null;
  if (/\b(status|stage|workflow)\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "status") ?? null;
  if (/\b(category|facility type|type of facility)\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "category") ?? null;
  if (/\blga\b|local government/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "lga") ?? null;
  if (/\blcda\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "lcda") ?? null;
  if (/\bscope\b|service/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "scope_of_service") ?? null;
  if (/\bstaff\b|\bdoctor\b|\bdoctors\b|\bnurse\b|\bnurses\b|\bcomplement\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "staff_complement") ?? null;
  if (token.includes("opening time")) return FIELD_DEFINITIONS.find((field) => field.intent === "opening_time") ?? null;
  if (token.includes("closing time")) return FIELD_DEFINITIONS.find((field) => field.intent === "closing_time") ?? null;
  if (/establish/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "establishment_date") ?? null;
  if (/ambulance/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "ambulance") ?? null;
  if (/emergency/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "emergency") ?? null;
  if (/\bcac\b/.test(text)) return FIELD_DEFINITIONS.find((field) => field.intent === "cac_number") ?? null;

  return null;
}

function cleanFacilityQuery(value: string) {
  return cleanInline(value)
    .replace(/^facility\s+/i, "")
    .replace(/^(the\s+)?facility\s+(called|named)\s+/i, "")
    .replace(/[?.!]+$/g, "")
    .trim();
}

function facilityQueryWords(value: string) {
  return normalizeToken(value)
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 1 && !GENERAL_QUERY_WORDS.has(word));
}

function stripIntentWordsFromQuery(value: string, intent: FieldDefinition) {
  const intentWords = new Set((INTENT_QUERY_WORDS[intent.intent] ?? []).map((word) => normalizeToken(word)).filter(Boolean));

  const words = normalizeToken(value)
    .split(" ")
    .filter((word) => word && !GENERAL_QUERY_WORDS.has(word) && !intentWords.has(word));

  return cleanFacilityQuery(words.join(" "));
}

function extractFacilityQuery(question: string, intent: FieldDefinition) {
  const patterns = [
    /\b(?:for|of|at|in)\s+(.+?)\s*\??$/i,
    /\b(?:called|named)\s+(.+?)\s*\??$/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) return stripIntentWordsFromQuery(match[1], intent);
  }

  const normalizedDisplay = normalizeToken(intent.displayName);
  const lowered = normalizeToken(question);
  if (lowered.includes(normalizedDisplay)) {
    return stripIntentWordsFromQuery(lowered.replace(normalizedDisplay, ""), intent);
  }

  return stripIntentWordsFromQuery(question, intent);
}

function detailSearchText(detail: LightweightPortalFacilityDetailRecord) {
  const indexedSearchText = (detail as QaIndexedDetail).qaSearchText;
  if (indexedSearchText) return indexedSearchText;

  return [
    detail.facilityName,
    detail.hefamaaId,
    detail.category,
    detail.registrationStatus,
    detail.normalizedStatus,
    detail.sourceRecord?.facilityName,
    detail.sourceRecord?.hefamaaId,
  ].join(" ");
}

function scoreDetail(detail: LightweightPortalFacilityDetailRecord, query: string) {
  const queryToken = normalizeToken(query);
  if (!queryToken) return 0;

  const nameToken = normalizeToken(detail.facilityName);
  const idToken = normalizeToken(detail.hefamaaId);
  const searchToken = normalizeToken(detailSearchText(detail));
  const queryWords = facilityQueryWords(query);
  if (!queryWords.length) return 0;

  const identityText = [nameToken, idToken].filter(Boolean).join(" ");
  const identityHits = queryWords.filter((word) => identityText.includes(word));

  // Field labels like address/status/email appear in many cached records. A result is
  // only trustworthy when the user's remaining words match the facility identity.
  if (!identityHits.length && nameToken !== queryToken && idToken !== queryToken) return 0;

  let score = 0;
  if (nameToken === queryToken || idToken === queryToken) score += 140;
  if (nameToken.includes(queryToken) || queryToken.includes(nameToken)) score += 90;
  if (idToken && idToken.includes(queryToken)) score += 90;
  if (identityHits.length === queryWords.length) score += 70 + queryWords.length * 8;
  else score += identityHits.length * 22;
  if (queryWords.every((word) => searchToken.includes(word))) score += 12;
  if (detail.renewalYear) score += Math.min(10, Math.max(0, detail.renewalYear - 2020));
  if (detail.capturedAt) score += 1;
  return score;
}

function sortLatestFirst(a: LightweightPortalFacilityDetailRecord, b: LightweightPortalFacilityDetailRecord) {
  return (b.renewalYear ?? 0) - (a.renewalYear ?? 0) || cleanInline(b.capturedAt).localeCompare(cleanInline(a.capturedAt));
}

function buildPortalQaIndex(sourceMtimeMs: number): QaIndexedDetail[] {
  const records = readPortalDetailsCacheLightweight().map((detail) => {
    const qaFields = Object.fromEntries(
      FIELD_DEFINITIONS
        .map((field) => [field.intent, fieldValueForIntent(detail, field.intent)] as const)
        .filter(([, value]) => cleanInline(value)),
    ) as Partial<Record<FieldIntent, string>>;

    // The chat screen should not parse every saved portal page body just to answer
    // common questions. We keep only searchable identity fields and extracted answers
    // in this compact index, then rebuild it whenever the detail cache changes.
    return {
      applicationType: detail.applicationType,
      cacheKey: detail.cacheKey,
      capturedAt: detail.capturedAt,
      category: detail.category,
      facilityName: detail.facilityName,
      hefamaaId: detail.hefamaaId,
      normalizedStatus: detail.normalizedStatus,
      qaFields,
      qaIndexVersion: QA_INDEX_VERSION,
      qaSearchText: detailSearchText(detail),
      recordDate: detail.recordDate,
      registrationStatus: detail.registrationStatus,
      renewalYear: detail.renewalYear,
      sourceRecord: detail.sourceRecord,
      staffComplement: detail.staffComplement,
      url: detail.url,
      visibleFields: detail.visibleFields,
    };
  });

  const file = qaIndexPath();
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ generatedAt: new Date().toISOString(), records, sourceMtimeMs, version: QA_INDEX_VERSION } satisfies PortalQaIndexFile));
  } catch {
    // If the index cannot be written, the in-memory records still make this request work.
  }

  qaIndexCache = { indexMtimeMs: safeMtime(file), records, sourceMtimeMs };
  return records;
}

function readPortalQaIndex() {
  const sourceMtimeMs = safeMtime(portalDetailsPath());
  const file = qaIndexPath();
  const indexMtimeMs = safeMtime(file);

  if (qaIndexCache?.sourceMtimeMs === sourceMtimeMs && qaIndexCache.indexMtimeMs === indexMtimeMs) {
    return qaIndexCache.records;
  }

  if (sourceMtimeMs && existsSync(file)) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as PortalQaIndexFile;
      if (parsed.version === QA_INDEX_VERSION && parsed.sourceMtimeMs === sourceMtimeMs && Array.isArray(parsed.records)) {
        qaIndexCache = { indexMtimeMs, records: parsed.records, sourceMtimeMs };
        return parsed.records;
      }
    } catch {
      // A partial index file should never break chat. Rebuilding from the detail cache is safer.
    }
  }

  if (!sourceMtimeMs) return [];
  return buildPortalQaIndex(sourceMtimeMs);
}

function findBestDetail(query: string) {
  const scored = readPortalQaIndex()
    .map((detail) => ({ detail, score: scoreDetail(detail, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || sortLatestFirst(a.detail, b.detail));

  const topScore = scored[0]?.score ?? 0;

  return {
    best: topScore >= 55 ? scored[0]?.detail ?? null : null,
    matches: scored.slice(0, 8).map((entry) => entry.detail),
    topScore,
  };
}

function countProfessionalComplements(detail: LightweightPortalFacilityDetailRecord) {
  const lines = detailLines(detail);
  const bounds = sectionBounds(lines, ["PROFESSIONAL STAFF"]);
  const counts = new Map<string, number>();
  if (!bounds) return counts;

  for (let index = bounds.start + 1; index < bounds.end; index += 1) {
    if (normalizeToken(lines[index]) !== "complement") continue;
    const value = cleanInline(lines[index + 1] ?? "");
    if (!value || isLikelyEmptyOrAction(value)) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return counts;
}

function staffComplementAnswer(detail: LightweightPortalFacilityDetailRecord) {
  const structuredCounts = Object.entries(detail.staffComplement ?? {})
    .filter(([key, value]) => key !== "Total" && Number(value) > 0)
    .map(([key, value]) => key + ": " + value);
  if (structuredCounts.length) return structuredCounts.join(", ");

  const textCounts = Array.from(countProfessionalComplements(detail).entries()).map(([label, count]) => label + ": " + count);
  return textCounts.join(", ");
}

function fieldRows(detail: LightweightPortalFacilityDetailRecord) {
  const values = FIELD_DEFINITIONS
    .map((field) => ({ Field: field.displayName, Value: fieldValueForIntent(detail, field.intent) || null }))
    .filter((row) => row.Value);
  return values.slice(0, 18);
}

function suggestionRows(details: LightweightPortalFacilityDetailRecord[]) {
  return details.map((detail) => ({
    Category: detail.category || null,
    Facility: detail.facilityName || null,
    "Portal Status": detail.registrationStatus || statusLabel(detail.normalizedStatus || "") || null,
    "Renewal Year": detail.renewalYear || null,
    "Captured At": detail.capturedAt || null,
  }));
}

function ambiguousFacilityMatches(query: string, best: LightweightPortalFacilityDetailRecord, matches: LightweightPortalFacilityDetailRecord[]) {
  const queryToken = normalizeToken(query);
  const bestNameToken = normalizeToken(best.facilityName);

  const exactEnough = bestNameToken === queryToken || bestNameToken.includes(queryToken) || queryToken.includes(bestNameToken);
  if (exactEnough) return [];

  const seen = new Set<string>();
  const uniqueMatches: LightweightPortalFacilityDetailRecord[] = [];
  for (const detail of matches) {
    const key = normalizeToken(detail.facilityName || detail.hefamaaId);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniqueMatches.push(detail);
  }

  const queryWords = facilityQueryWords(query);
  const fullIdentityMatches = uniqueMatches.filter((detail) => {
    const identityText = normalizeToken([detail.facilityName, detail.hefamaaId].join(" "));
    return queryWords.every((word) => identityText.includes(word));
  });
  const candidates = fullIdentityMatches.length ? fullIdentityMatches : uniqueMatches;

  return candidates.length > 1 ? candidates.slice(0, 8) : [];
}

function compactRecord(detail: LightweightPortalFacilityDetailRecord) {
  return {
    capturedAt: detail.capturedAt,
    category: detail.category,
    facilityName: detail.facilityName,
    hefamaaId: detail.hefamaaId,
    normalizedStatus: detail.normalizedStatus,
    registrationStatus: detail.registrationStatus,
    renewalYear: detail.renewalYear,
    visibleFields: {
      Address: fieldValueForIntent(detail, "address"),
      Email: fieldValueForIntent(detail, "email"),
      LGA: fieldValueForIntent(detail, "lga"),
      "Medical Professional In-Charge": fieldValueForIntent(detail, "medical_in_charge"),
      Phone: fieldValueForIntent(detail, "contact_phone"),
      "Scope of Service": fieldValueForIntent(detail, "scope_of_service"),
    },
  };
}

function listFallbackRows(query: string) {
  const queryToken = normalizeToken(query);
  if (!queryToken) return [];
  return readPortalListCacheLightweight()
    .filter((record: LightweightPortalFacilityRecord) => normalizeToken([record.facilityName, record.hefamaaId, record.text].join(" ")).includes(queryToken))
    .slice(0, 8)
    .map((record) => ({
      Category: record.category || null,
      Facility: record.facilityName || null,
      "Portal ID": record.hefamaaId || null,
      Status: record.registrationStatus || record.normalizedStatus || null,
      "Renewal Year": record.renewalYear || null,
    }));
}

export function answerPortalCacheQuestion(question: string): PortalCacheQuestionAnswer | null {
  const startedAt = Date.now();
  const intent = inferIntent(question);
  if (!intent) return null;

  const facilityQuery = extractFacilityQuery(question, intent);
  if (!facilityQuery || normalizeToken(facilityQuery).length < 2) return null;

  const { best, matches, topScore } = findBestDetail(facilityQuery);
  if (!best) {
    const fallbackRows = listFallbackRows(facilityQuery);
    return {
      answer: fallbackRows.length
        ? "I could not confidently identify the exact facility for " + facilityQuery + ". I found possible portal list matches, but I do not have a reliable detail match for the requested " + intent.displayName + ". Please provide the full facility name, HEFAMAA number, or category before I answer."
        : "I could not find a reliable record for " + facilityQuery + " in the local portal detail cache. Please confirm the facility name, HEFAMAA number, or category and try again.",
      rows: fallbackRows.length ? fallbackRows : suggestionRows(matches),
      summary: { answeredFrom: "portal_cache", detailMatchCount: 0, elapsedMs: Date.now() - startedAt, facilityQuery, matchConfidence: "low", topScore },
    };
  }

  const ambiguousMatches = ambiguousFacilityMatches(facilityQuery, best, matches);
  if (ambiguousMatches.length) {
    return {
      answer: "I found multiple facilities that could match " + facilityQuery + ". To avoid mixing records, please specify the exact facility name, category, location, or HEFAMAA number before I provide the " + intent.displayName + ".",
      rows: suggestionRows(ambiguousMatches),
      summary: { answeredFrom: "portal_cache", detailMatchCount: matches.length, elapsedMs: Date.now() - startedAt, facilityQuery, matchConfidence: "needs_clarification" },
    };
  }

  const value = fieldValueForIntent(best, intent.intent);
  if (!value) {
    return {
      answer: "I found " + best.facilityName + " in the portal detail cache, but the cached page does not contain a readable value for " + intent.displayName + ". Re-capture the facility after opening the relevant portal section.",
      record: compactRecord(best),
      rows: fieldRows(best),
      summary: { answeredFrom: "portal_cache", detailMatchCount: matches.length, elapsedMs: Date.now() - startedAt },
    };
  }

  return {
    answer: "The " + intent.displayName + " for " + best.facilityName + " is " + value + ".",
    record: compactRecord(best),
    rows: fieldRows(best),
    summary: { answeredFrom: "portal_cache", detailMatchCount: matches.length, elapsedMs: Date.now() - startedAt, facilityQuery },
  };
}
