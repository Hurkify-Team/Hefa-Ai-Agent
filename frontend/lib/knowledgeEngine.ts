import { getConversationMemory, updateConversationMemory } from "@/lib/conversationMemory";
import { routeDataSources, type KnowledgeDataSource } from "@/lib/dataSourceRouter";
import { detectIntent, type DetectedIntent } from "@/lib/intentDetector";
import { buildNotificationIntelligence } from "@/lib/notificationEngine";
import { normalizeFacilityName, normalizeHeaderName, normalizeLGA } from "@/lib/normalizers";
import { readPortalCacheRows, type PortalCacheRow } from "@/lib/portalCacheModel";
import { answerRegistrationApprovedAnalyticsQuestion, buildPortalWorkflowSummary, isRegistrationApprovedAnalyticsQuestion, PORTAL_WORKFLOW_LABELS, type PortalWorkflowStatus } from "@/lib/portalWorkflow";
import { searchFacilityIndex } from "@/lib/facilitySearchIndex";
import { nonEmptyRows, readLimitedWorkbook } from "@/lib/lightweightSheets";
import { getSourceAllSheetData, isWorkbookSourceConfigured, WORKBOOK_SOURCE_LABELS, type WorkbookSource } from "@/lib/workbookSources";
import type { SheetRow } from "@/types/sheet";

export type KnowledgeAnswerInput = {
  category?: string;
  question: string;
  requestedSources?: Array<"portal" | "sheets">;
  sessionId?: string;
};

export type KnowledgeAnswer = {
  actions?: Array<{ description: string; href: string; label: string; source: "portal" | "sheets" | "notifications" }>;
  answer: string;
  confidence: number;
  intent: DetectedIntent;
  rows?: Array<Record<string, unknown>>;
  sources: Array<{ label: string; source: KnowledgeDataSource; status: "ok" | "error"; summary?: unknown }>;
  summary?: Record<string, unknown>;
};

type WorkbookKnowledgeRow = {
  source: WorkbookSource;
  sourceLabel: string;
  category: string;
  rowIndex: number;
  row: SheetRow;
  hefNo: string;
  facilityName: string;
  address: string;
  lga: string;
  contact: string;
  email: string;
};

const SHEET_FIELD_ALIASES = {
  address: ["Address", "ADDRESS", "Facility Address"],
  contact: ["Contact", "Phone", "Phone Number", "Phone No", "Telephone"],
  email: ["Facility E-Mail", "Facility Email", "Email", "E-Mail", "E-MAIL"],
  facilityName: ["Facility Name", "FACILITY NAME", "Name", "Name of Facility", "FACILITY", "Facility"],
  hefNo: ["HEF/NO", "HEF NO", "HEFA NO", "HEFAMAA NO", "HF NO", "HEFA Number", "HEFAMAA Number", "Facility Code", "FACILITY CODE", "Facility ID", "Registration Number"],
  lga: ["LGA", "Local Government"],
};

type BedType = "admissionBeds" | "observationBeds" | "couches";

const BED_FIELD_ALIASES: Record<BedType, string[]> = {
  admissionBeds: ["Admission Bed", "Admission Beds", "ADMISSION BEDS", "Admission Beds Count", "No of Admission Beds"],
  observationBeds: ["Observation Bed", "Observation Beds", "OBSERVATION BEDS", "Observation Beds Count", "No of Observation Beds"],
  couches: ["No of Couches", "Couches", "COUCHES", "Couch", "Number of Couches"],
};

const OPERATING_OFFICER_ALIASES = [
  "Medical Professional in Charge",
  "Medical Professional In-Charge",
  "Medical Officer in Charge",
  "Operating Officer",
  "Officer in Charge",
  "Professional in Charge",
];

const FACILITY_CODE_ALIASES = SHEET_FIELD_ALIASES.hefNo;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactValue(value: unknown) {
  const text = clean(value);
  return text.length > 180 ? text.slice(0, 177) + "..." : text;
}

function valueFor(row: SheetRow, aliases: string[]) {
  const normalizedLookup = new Map(Object.entries(row).map(([key, value]) => [normalizeHeaderName(key), value] as const));
  for (const alias of aliases) {
    const direct = row[alias];
    if (direct !== undefined && direct !== null && clean(direct)) return clean(direct);
    const normalized = normalizedLookup.get(normalizeHeaderName(alias));
    if (normalized !== undefined && normalized !== null && clean(normalized)) return clean(normalized);
  }
  return "";
}

function rowToWorkbookKnowledge(source: WorkbookSource, category: string, row: SheetRow, rowIndex: number): WorkbookKnowledgeRow {
  return {
    source,
    sourceLabel: WORKBOOK_SOURCE_LABELS[source],
    category,
    rowIndex,
    row,
    hefNo: valueFor(row, SHEET_FIELD_ALIASES.hefNo),
    facilityName: valueFor(row, SHEET_FIELD_ALIASES.facilityName),
    address: valueFor(row, SHEET_FIELD_ALIASES.address),
    lga: valueFor(row, SHEET_FIELD_ALIASES.lga),
    contact: valueFor(row, SHEET_FIELD_ALIASES.contact),
    email: valueFor(row, SHEET_FIELD_ALIASES.email),
  };
}

async function readWorkbookRows(source: WorkbookSource) {
  if (!isWorkbookSourceConfigured(source)) return [];

  if (source === "active") {
    const workbook = await readLimitedWorkbook(Number(process.env.HEFAI_KNOWLEDGE_MAX_ROWS ?? process.env.DASHBOARD_SUMMARY_MAX_ROWS ?? 5000));
    return workbook.sheets.flatMap((sheet) => nonEmptyRows(sheet.rows).map((row, index) => rowToWorkbookKnowledge(source, sheet.title, row, index + 2)));
  }

  const data = await getSourceAllSheetData(source);
  return Object.entries(data).flatMap(([category, sheet]) => sheet.rows.map((row, index) => rowToWorkbookKnowledge(source, category, row, index + 2)));
}

async function readAllWorkbookRows() {
  const active = await readWorkbookRows("active");
  if (active.length) return active;
  return readWorkbookRows("old");
}

function categoryMatches(actual: unknown, expected?: string | null) {
  if (!expected) return true;
  const a = normalize(actual);
  const e = normalize(expected);
  return Boolean(a && e && (a === e || a.includes(e) || e.includes(a)));
}

function lgaMatches(actual: unknown, expected?: string | null) {
  if (!expected) return true;
  return normalizeLGA(clean(actual)) === normalizeLGA(expected) || normalize(actual).includes(normalize(expected));
}

function statusMatches(actual: unknown, expected?: string | null) {
  if (!expected) return true;
  return normalize(actual).includes(normalize(expected));
}

function filterWorkbook(rows: WorkbookKnowledgeRow[], intent: DetectedIntent) {
  const entity = intent.entities;
  return rows.filter((row) => {
    if (!categoryMatches(row.category, entity.category)) return false;
    if (!lgaMatches(row.lga, entity.lga)) return false;
    if (entity.facilityName && !normalizeFacilityName(row.facilityName).includes(normalizeFacilityName(entity.facilityName))) return false;
    if (entity.hefNo && normalize(row.hefNo) !== normalize(entity.hefNo)) return false;
    return true;
  });
}

function facilityNameMatchesPortal(row: PortalCacheRow, query: string) {
  const compactQuery = normalize(query).replace(/\s+/g, "");
  const compactName = normalize(row.facility_name).replace(/\s+/g, "");
  if (!compactQuery || !compactName) return false;
  if (compactName.includes(compactQuery) || compactQuery.includes(compactName)) return true;

  const generic = new Set(["clinic", "hospital", "laboratory", "lab", "facility", "centre", "center", "medical", "health"]);
  const tokens = normalize(query).split(/\s+/).filter((token) => token.length > 2 && !generic.has(token));
  if (tokens.length >= 2) return tokens.every((token) => normalize(row.facility_name).includes(token));
  if (tokens.length === 1 && tokens[0].length >= 4) return normalize(row.facility_name).includes(tokens[0]);
  return false;
}

function filterPortal(rows: PortalCacheRow[], intent: DetectedIntent) {
  const entity = intent.entities;
  return rows.filter((row) => {
    if (!categoryMatches(row.category, entity.category)) return false;
    if (!lgaMatches(row.lga, entity.lga)) return false;
    if (!statusMatches(row.registration_status, entity.status)) return false;
    if (entity.facilityName && !facilityNameMatchesPortal(row, entity.facilityName)) return false;
    if (entity.hefNo && normalize(portalFacilityCode(row)) !== normalize(entity.hefNo) && normalize(row.hef_no) !== normalize(entity.hefNo)) return false;
    return true;
  });
}

function isPendingRequirements(row: PortalCacheRow) {
  return /quer|pending|upload payment|payment approved/i.test([row.registration_status, row.requirements_status].join(" "));
}

function isExpiredAccreditation(row: PortalCacheRow) {
  return /expired/i.test([row.accreditation_status, row.registration_status, row.raw_portal_text].join(" "));
}

function countBy<T>(rows: T[], keyer: (row: T) => string | null | undefined) {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = clean(keyer(row)) || "Unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function publicWorkbookRow(row: WorkbookKnowledgeRow): Record<string, unknown> {
  return {
    Source: row.sourceLabel,
    Category: row.category,
    "Row No": row.rowIndex,
    "HEF/NO": row.hefNo,
    "Facility Name": row.facilityName,
    Address: row.address,
    LGA: row.lga,
    Contact: row.contact,
    Email: row.email,
  };
}

function publicPortalRow(row: PortalCacheRow): Record<string, unknown> {
  return {
    Source: "HEFAMAA Portal Cache",
    Category: row.category,
    "Facility Name": row.facility_name,
    "HEF/NO / Portal ID": row.hef_no,
    "Facility Code": portalFacilityCode(row),
    Address: row.address,
    LGA: row.lga,
    LCDA: row.lcda,
    Contact: row.contact,
    Email: row.email,
    Owner: row.owner_name,
    Status: row.registration_status,
    "Requirements Status": row.requirements_status,
    "Doctors Count": row.doctors_count,
    "Nurses Count": row.nurses_count,
    "Operating Officer": portalOperatingOfficer(row) || null,
    "Admission Beds": getBedValue(row, "admissionBeds").value,
    "Observation Beds": getBedValue(row, "observationBeds").value,
    Couches: getBedValue(row, "couches").value,
    "Captured At": row.captured_at,
  };
}


function workflowStatusFromQuestion(question: string): PortalWorkflowStatus | null {
  if (/document\s+quer|queried/i.test(question)) return "DOCUMENT_QUERY";
  if (/upload\s+payment|upload\s+payment\/document/i.test(question)) return "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING";
  if (/payment\s+approved.*document|payment\s+approved\/document/i.test(question)) return "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING";
  if (/document\s+approved.*inspection|inspection\s+report\s+pending/i.test(question)) return "DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING";
  if (/inspection\s+approval|inspection\s+report\s+upload/i.test(question)) return "INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING";
  if (/final\s+approval/i.test(question)) return "FINAL_APPROVAL_PENDING";
  if (/registration\s+approved|approved\s+facilit|license\s+(ready|issued|approved)|licence\s+(ready|issued|approved)/i.test(question)) return "REGISTRATION_APPROVED";
  return null;
}

function sectorFromQuestion(question: string): "PUBLIC" | "PRIVATE" | null {
  if (/\b(public|government|govt)\b|public\s+sector|government owned/i.test(question)) return "PUBLIC";
  if (/\b(private|privately)\b|private\s+sector|privately owned/i.test(question)) return "PRIVATE";
  return null;
}

function lgaFromQuestion(question: string) {
  const match = question.match(/\bin\s+([a-z][a-z\s-]+?)(?:\s+lga|\s+local government|\?|$)/i);
  return match?.[1]?.trim() ?? "";
}

function portalWorkflowAnswer(question: string, requiresList?: boolean) {
  const workflow = buildPortalWorkflowSummary();
  const sector = sectorFromQuestion(question);
  const status = workflowStatusFromQuestion(question);
  if (sector) {
    const requestedLga = lgaFromQuestion(question);
    const facilities = workflow.facilities.filter((facility) => facility.sector === sector && (!requestedLga || String(facility.lga ?? "").toLowerCase().includes(requestedLga.toLowerCase())));
    if (/compare/i.test(question)) {
      return {
        answer: "The portal cache shows " + workflow.sectorCounts.PUBLIC.toLocaleString() + " public sector facilities and " + workflow.sectorCounts.PRIVATE.toLocaleString() + " private sector facilities.",
        rows: [
          { Sector: "Public", Count: workflow.sectorCounts.PUBLIC },
          { Sector: "Private", Count: workflow.sectorCounts.PRIVATE },
          { Sector: "Unknown", Count: workflow.sectorCounts.UNKNOWN },
        ],
        summary: { sectorCounts: workflow.sectorCounts, source: workflow.source, lastScan: workflow.lastScan },
      };
    }
    const rows = requiresList || /show|list|which|display|facilities/i.test(question)
      ? facilities.slice(0, 50).map((facility) => ({
          "Facility Name": facility.facilityName,
          "HEFA NO / Facility Code": facility.facilityCode,
          Category: facility.category,
          LGA: facility.lga,
          Sector: facility.sector,
          Status: facility.currentWorkflowStatusLabel,
          "Last Scan Date": facility.lastScanDate,
        }))
      : [];
    return {
      answer: facilities.length.toLocaleString() + " " + (sector === "PUBLIC" ? "public" : "private") + " sector facilit" + (facilities.length === 1 ? "y is" : "ies are") + (requestedLga ? " recorded in " + requestedLga : " recorded") + " in the portal scan cache.",
      rows,
      summary: { sector, count: facilities.length, sectorCounts: workflow.sectorCounts, source: workflow.source, lastScan: workflow.lastScan },
    };
  }
  if (status) {
    const facilities = workflow.facilities.filter((facility) => facility.currentWorkflowStatus === status);
    const rows = requiresList || /show|list|which|display|awaiting/i.test(question)
      ? facilities.slice(0, 50).map((facility) => ({
          "Facility Name": facility.facilityName,
          "HEFA NO / Facility Code": facility.facilityCode,
          Category: facility.category,
          LGA: facility.lga,
          "Current Workflow Status": facility.currentWorkflowStatusLabel,
          "Last Activity Date": facility.lastActivityDate,
          "Last Scan Date": facility.lastScanDate,
        }))
      : [];
    return {
      answer: facilities.length.toLocaleString() + " facilit" + (facilities.length === 1 ? "y is" : "ies are") + " currently under " + PORTAL_WORKFLOW_LABELS[status] + " in the portal scan cache.",
      rows,
      summary: { status, count: facilities.length, source: workflow.source, lastScan: workflow.lastScan },
    };
  }
  return {
    answer: "I grouped the HEFAMAA portal cache by the seven official workflow statuses.",
    rows: Object.entries(workflow.statusCounts).map(([statusKey, count]) => ({ Status: PORTAL_WORKFLOW_LABELS[statusKey as PortalWorkflowStatus], Count: count })),
    summary: { totalPortalRecords: workflow.totalPortalRecords, source: workflow.source, lastScan: workflow.lastScan },
  };
}

type NotificationAttentionCard = { count?: number; facilityReminderCount?: number; key: string; staffActionCount?: number };
type NotificationVerificationRow = Record<string, unknown>;

function publicNotificationRow(row: Record<string, unknown>): Record<string, unknown> {
  return { Source: "Facility Notifications", ...row };
}

function notificationRowsForStatus(rows: Array<Record<string, unknown>>, statusKey: string) {
  return rows.filter((row) => normalize(row["Status Key"]) === normalize(statusKey));
}

function notificationAnswer(intent: DetectedIntent) {
  const intelligence = buildNotificationIntelligence({ limit: 100 });
  const allActionRows = [...intelligence.reminderQueue, ...intelligence.hefamaaAttention].map(publicNotificationRow);

  if (intent.intent === "notification_document_queried") {
    const card = intelligence.attentionCards.find((item: NotificationAttentionCard) => item.key === "DOCUMENT_QUERIED");
    const rows = intent.requiresList ? notificationRowsForStatus(allActionRows, "DOCUMENT_QUERIED").slice(0, 50) : [];
    return {
      answer: (card?.count ?? 0).toLocaleString() + " facilit" + ((card?.count ?? 0) === 1 ? "y is" : "ies are") + " document queried. " + (card?.facilityReminderCount ?? 0).toLocaleString() + " require facility reminders, and " + (card?.staffActionCount ?? 0).toLocaleString() + " require HEFAMAA staff attention.",
      rows,
      summary: { count: card?.count ?? 0, facilityReminderCount: card?.facilityReminderCount ?? 0, staffActionCount: card?.staffActionCount ?? 0 },
    };
  }

  if (intent.intent === "notification_reminders_today") {
    const rows = intent.requiresList ? intelligence.reminderQueue.slice(0, 50).map(publicNotificationRow) : [];
    return {
      answer: intelligence.reminderQueueCount.toLocaleString() + " facilities require reminders today. " + intelligence.staleCacheBlockedCount.toLocaleString() + " reminder candidates are blocked until live portal verification confirms their current status.",
      rows,
      summary: { count: intelligence.reminderQueueCount, staleCacheBlockedCount: intelligence.staleCacheBlockedCount },
    };
  }

  if (intent.intent === "notification_hefamaa_action") {
    const rows = intent.requiresList ? intelligence.hefamaaAttention.slice(0, 50).map(publicNotificationRow) : [];
    return {
      answer: intelligence.hefamaaAttentionCount.toLocaleString() + " facilities require HEFAMAA action. These facilities show current-year activity, so reminders should not be sent to the facility owners for those statuses.",
      rows,
      summary: { count: intelligence.hefamaaAttentionCount },
    };
  }

  if (intent.intent === "notification_final_approval_pending") {
    const rows = intent.requiresList ? notificationRowsForStatus(allActionRows, "FINAL_APPROVAL_PENDING").slice(0, 50) : [];
    const card = intelligence.attentionCards.find((item: NotificationAttentionCard) => item.key === "FINAL_APPROVAL_PENDING");
    return {
      answer: (card?.count ?? rows.length).toLocaleString() + " facilities are awaiting final approval. Current-year items are HEFAMAA action flags; previous-year unresolved items stay in the facility reminder queue.",
      rows,
      summary: { count: card?.count ?? rows.length, facilityReminderCount: card?.facilityReminderCount ?? 0, staffActionCount: card?.staffActionCount ?? 0 },
    };
  }

  if (intent.intent === "notification_overdue_renewal") {
    const rows = intent.requiresList ? intelligence.renewalOverdue.slice(0, 50).map(publicNotificationRow) : [];
    return {
      answer: intelligence.renewalOverdueCount.toLocaleString() + " facilities appear to have overdue renewal activity based on the current portal cache and renewal window rule.",
      rows,
      summary: { count: intelligence.renewalOverdueCount },
    };
  }

  if (intent.intent === "notification_stale_cache") {
    const rows = intent.requiresList ? intelligence.staleCache.slice(0, 50).map(publicNotificationRow) : [];
    return {
      answer: intelligence.staleCacheCount.toLocaleString() + " facilities have cache older than 7 days or no reliable cache timestamp. Reminders from those records are blocked until live portal verification succeeds.",
      rows,
      summary: { count: intelligence.staleCacheCount, blockedReminderCount: intelligence.staleCacheBlockedCount },
    };
  }

  if (intent.intent === "notification_changed_status") {
    const rows = intent.requiresList ? intelligence.changedAfterVerification.slice(0, 50).map((row: NotificationVerificationRow) => publicNotificationRow(row)) : [];
    return {
      answer: intelligence.changedAfterVerificationCount.toLocaleString() + " facilities have changed status after live portal verification was recorded.",
      rows,
      summary: { count: intelligence.changedAfterVerificationCount },
    };
  }

  return null;
}

function missingFieldCount(rows: WorkbookKnowledgeRow[], field?: string | null) {
  const targetField = normalize(field || "");
  let missing = 0;
  for (const row of rows) {
    if (targetField) {
      const entries = Object.entries(row.row);
      const found = entries.find(([header]) => normalize(header).includes(targetField));
      if (!found || !clean(found[1])) missing += 1;
    } else if (!row.facilityName || !row.contact || !row.email || !row.address || !row.lga) {
      missing += 1;
    }
  }
  return missing;
}

function staffMetric(intent: DetectedIntent) {
  const field = normalize(intent.entities.field);
  if (field.includes("nurse")) return { label: "nurses", reader: (row: PortalCacheRow) => row.nurses_count ?? 0 };
  return { label: "doctors", reader: (row: PortalCacheRow) => row.doctors_count ?? 0 };
}

function portalStructuredObjects(row: PortalCacheRow) {
  const data = row.structured_portal_data ?? {};
  const objects: Array<Record<string, unknown>> = [];
  for (const key of ["visibleFields", "formFields", "qaFields"] as const) {
    const value = (data as Record<string, unknown>)[key];
    if (value && typeof value === "object" && !Array.isArray(value)) objects.push(value as Record<string, unknown>);
  }
  return objects;
}

function portalFieldValue(row: PortalCacheRow, aliases: string[]) {
  const normalizedAliases = aliases.map(normalize);
  for (const fields of portalStructuredObjects(row)) {
    for (const [key, value] of Object.entries(fields)) {
      const normalizedKey = normalize(key);
      if (normalizedAliases.some((alias) => normalizedKey === alias || normalizedKey.includes(alias) || alias.includes(normalizedKey))) {
        const cleaned = clean(value);
        if (cleaned) return cleaned;
      }
    }
  }

  const lines = clean(row.raw_portal_text).split(/\n+/).map(clean).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = normalize(lines[index]);
    if (!normalizedAliases.some((alias) => line === alias || line.includes(alias))) continue;
    const next = clean(lines[index + 1]);
    if (next) return next;
  }
  return "";
}

function parseBedNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  const text = clean(value);
  if (!text || /^(-|—|n\/?a|not applicable|nil|none|null)$/i.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function getStructuredBedValue(row: PortalCacheRow, type: BedType) {
  const direct = row[type];
  if (typeof direct === "number") return direct;
  const nested = row.bedDistribution?.[type];
  if (typeof nested === "number") return nested;
  const structured = row.structured_portal_data?.bedDistribution;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) {
    const value = (structured as Record<string, unknown>)[type];
    if (typeof value === "number") return value;
  }
  return null;
}

function getBedValue(row: PortalCacheRow, type: BedType) {
  const structuredValue = getStructuredBedValue(row, type);
  const value = structuredValue ?? parseBedNumber(portalFieldValue(row, BED_FIELD_ALIASES[type]));
  return { missing: value === null, value };
}

function bedLabel(type: BedType) {
  if (type === "admissionBeds") return "admission beds";
  if (type === "observationBeds") return "observation beds";
  return "couches";
}

function bedTypeFromField(field?: string | null): BedType | null {
  const normalized = normalize(field);
  if (normalized.includes("admission")) return "admissionBeds";
  if (normalized.includes("observation")) return "observationBeds";
  if (normalized.includes("couch")) return "couches";
  return null;
}

function portalOperatingOfficer(row: PortalCacheRow) {
  return portalFieldValue(row, OPERATING_OFFICER_ALIASES);
}

function portalFacilityCode(row: PortalCacheRow) {
  return portalFieldValue(row, FACILITY_CODE_ALIASES) || clean(row.hef_no);
}

type BedDistributionFilters = { category?: string | null; facilityNameOrCode?: string | null; hefNo?: string | null; lcda?: string | null; lga?: string | null };

function filterBedRows(rows: PortalCacheRow[], filters: BedDistributionFilters = {}) {
  return rows.filter((row) => {
    if (filters.category && !categoryMatches(row.category, filters.category)) return false;
    if (filters.lga && !lgaMatches(row.lga, filters.lga)) return false;
    if (filters.lcda && !normalize(row.lcda).includes(normalize(filters.lcda))) return false;
    const lookup = filters.facilityNameOrCode || filters.hefNo;
    if (lookup) {
      const query = normalize(lookup);
      const code = normalize(portalFacilityCode(row));
      const hefNo = normalize(row.hef_no);
      const name = normalize(row.facility_name);
      if (!(name === query || name.includes(query) || code === query || code.includes(query) || hefNo === query || hefNo.includes(query))) return false;
    }
    return true;
  });
}

export function getTotalBeds(type: BedType, rows: PortalCacheRow[] = readPortalCacheRows(), filters: BedDistributionFilters = {}) {
  const filteredRows = filterBedRows(rows, filters);
  let total = 0;
  let missingFacilities = 0;
  let facilitiesWithData = 0;
  for (const row of filteredRows) {
    const bed = getBedValue(row, type);
    if (bed.value === null) {
      missingFacilities += 1;
      continue;
    }
    facilitiesWithData += 1;
    total += bed.value;
  }
  return { facilities: filteredRows.length, facilitiesWithData, missingFacilities, total, type };
}

export function getBedsByLGA(type: BedType, lga?: string | null, rows: PortalCacheRow[] = readPortalCacheRows(), filters: Omit<BedDistributionFilters, "lga"> = {}) {
  const groups = new Map<string, { facilities: number; facilitiesWithData: number; lga: string; missingFacilities: number; total: number }>();
  for (const row of filterBedRows(rows, { ...filters, lga })) {
    const key = clean(row.lga) || "Unknown";
    const current = groups.get(key) ?? { facilities: 0, facilitiesWithData: 0, lga: key, missingFacilities: 0, total: 0 };
    const bed = getBedValue(row, type);
    current.facilities += 1;
    if (bed.value === null) current.missingFacilities += 1;
    else {
      current.facilitiesWithData += 1;
      current.total += bed.value;
    }
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.total - a.total || a.lga.localeCompare(b.lga));
}

export function getBedsForFacility(facilityNameOrCode: string, rows: PortalCacheRow[] = readPortalCacheRows()) {
  const query = normalize(facilityNameOrCode);
  if (!query) return null;
  const exact = rows.find((row) => normalize(row.facility_name) === query || normalize(portalFacilityCode(row)) === query || normalize(row.hef_no) === query);
  const partial = exact ?? rows.find((row) => normalize(row.facility_name).includes(query) || normalize(portalFacilityCode(row)).includes(query) || normalize(row.hef_no).includes(query));
  if (!partial) return null;
  const admission = getBedValue(partial, "admissionBeds");
  const observation = getBedValue(partial, "observationBeds");
  const couches = getBedValue(partial, "couches");
  return {
    row: partial,
    admissionBeds: admission.value,
    observationBeds: observation.value,
    couches: couches.value,
    missingFields: [admission.missing ? "admissionBeds" : "", observation.missing ? "observationBeds" : "", couches.missing ? "couches" : ""].filter(Boolean),
  };
}

export function getBedDistributionSummary(filters: BedDistributionFilters & { type?: BedType | null } = {}) {
  const rows = readPortalCacheRows();
  if (filters.facilityNameOrCode || filters.hefNo) return { mode: "facility" as const, result: getBedsForFacility(filters.facilityNameOrCode || filters.hefNo || "", rows) };
  const type = filters.type ?? "admissionBeds";
  if (filters.lga || /by_lga/i.test(clean(filters.lga))) return { mode: "lga" as const, result: getBedsByLGA(type, filters.lga, rows, { category: filters.category, facilityNameOrCode: filters.facilityNameOrCode, hefNo: filters.hefNo, lcda: filters.lcda }), type };
  return { mode: "total" as const, result: getTotalBeds(type, rows, filters), type };
}

function detailAnswerFromRows(question: string, rows: { portal: PortalCacheRow[]; workbook: WorkbookKnowledgeRow[] }, intent: DetectedIntent) {
  const field = intent.entities.field;
  const portal = rows.portal[0];
  const sheet = rows.workbook[0];

  if (field === "hef_no") {
    if (!sheet) return { answer: "I could not find the facility in the HEFAMAA Google Sheet database.", rows: [] };
    return {
      answer: "The HEFAMAA number for " + sheet.facilityName + " is " + (sheet.hefNo || "not recorded") + ". I used the Google Sheet HEF/NO or old database Facility Code field, not the portal ID.",
      rows: [publicWorkbookRow(sheet)],
    };
  }

  if (portal) {
    const fieldMap: Record<string, [string, unknown]> = {
      address: ["address", portal.address],
      contact: ["phone/contact", portal.contact],
      email: ["email", portal.email],
      operating_officer: ["operating officer / medical professional in charge", portalOperatingOfficer(portal)],
      medical_professional_in_charge: ["operating officer / medical professional in charge", portalOperatingOfficer(portal)],
      admission_beds: ["admission beds", getBedValue(portal, "admissionBeds").value],
      observation_beds: ["observation beds", getBedValue(portal, "observationBeds").value],
      couches: ["couches", getBedValue(portal, "couches").value],
      owner_name: ["owner/proprietor", portal.owner_name],
      registration_status: ["portal status", portal.registration_status],
      doctors_count: ["doctor count", portal.doctors_count],
      nurses_count: ["nurse count", portal.nurses_count],
    };
    const [label, value] = fieldMap[field || ""] ?? ["available details", null];
    if (value !== null && value !== undefined && clean(value)) {
      return { answer: "The " + label + " for " + (portal.facility_name || "this facility") + " is " + clean(value) + ".", rows: [publicPortalRow(portal)] };
    }
    return { answer: "I found " + (portal.facility_name || "the facility") + " in the portal cache, but that field is not available in the captured data yet.", rows: [publicPortalRow(portal)] };
  }

  if (sheet) return { answer: "I found the facility in the Google Sheet database.", rows: [publicWorkbookRow(sheet)] };
  return { answer: "I could not find a matching facility in the selected data sources.", rows: [] };
}

function buildActions(question: string, intent: DetectedIntent) {
  const actions: KnowledgeAnswer["actions"] = [];
  if (/export|download|report|visual|chart|graph|summary|breakdown/i.test(question)) {
    const params = new URLSearchParams();
    if (intent.entities.category) params.set("category", intent.entities.category);
    if (intent.entities.lga) params.set("lga", intent.entities.lga);
    const suffix = params.toString() ? "?" + params.toString() : "";
    actions.push({ source: "portal", label: "Download Excel Data", href: "/api/portal/export/excel" + suffix, description: "Export filtered portal cache data" });
    actions.push({ source: "portal", label: "Download PDF Report", href: "/api/portal/export/pdf" + suffix, description: "Export filtered portal report" });
    actions.push({ source: "portal", label: "Open Visual Charts", href: "/api/portal/export/visual" + suffix, description: "Open visual report charts" });
  }
  if (intent.intent === "notification_targets" || intent.intent.startsWith("notification_")) {
    actions.push({ source: "notifications", label: "Open Notification Preview", href: "/notifications/compose", description: "Preview recipients and message before any email or SMS is sent" });
    actions.push({ source: "notifications", label: "Open Notification Dashboard", href: "/notifications", description: "Review HEFAMAA attention flags, stale cache, and reminder queues" });
  }
  return actions;
}

export async function answerQuestion(input: KnowledgeAnswerInput): Promise<KnowledgeAnswer> {
  const memory = getConversationMemory(input.sessionId);
  const detected = await detectIntent(input.question, memory);
  const intent: DetectedIntent = input.category ? { ...detected, entities: { ...detected.entities, category: input.category } } : detected;
  const sources = routeDataSources(intent, input.question);
  const sourceStatus: KnowledgeAnswer["sources"] = [];
  let workbookRows: WorkbookKnowledgeRow[] = [];
  let portalRows: PortalCacheRow[] = [];

  if (sources.includes("google_sheet")) {
    try {
      if (intent.entities.hefNo) {
        const search = await searchFacilityIndex(intent.entities.hefNo, 10);
        workbookRows = search.results.map((row) => rowToWorkbookKnowledge(row.source, row.category, row.row, row.rowNumber));
      } else {
        workbookRows = filterWorkbook(await readAllWorkbookRows(), intent);
      }
      sourceStatus.push({ label: "HEFAMAA Active + Old Databases", source: "google_sheet", status: "ok", summary: { rows: workbookRows.length } });
    } catch (error) {
      sourceStatus.push({ label: "HEFAMAA Active + Old Databases", source: "google_sheet", status: "error", summary: { error: error instanceof Error ? error.message : "Sheet lookup failed" } });
    }
  }

  if (sources.includes("portal_cache")) {
    try {
      portalRows = filterPortal(readPortalCacheRows(), intent);
      sourceStatus.push({ label: "HEFAMAA Portal Cache", source: "portal_cache", status: "ok", summary: { rows: portalRows.length } });
    } catch (error) {
      sourceStatus.push({ label: "HEFAMAA Portal Cache", source: "portal_cache", status: "error", summary: { error: error instanceof Error ? error.message : "Portal cache lookup failed" } });
    }
  }

  let answer = "I could not understand the question well enough to calculate an answer yet.";
  let rows: Array<Record<string, unknown>> = [];
  const summary: Record<string, unknown> = { intent: intent.intent, sources };

  if (sources.includes("portal_cache") && isRegistrationApprovedAnalyticsQuestion(input.question)) {
    const result = answerRegistrationApprovedAnalyticsQuestion(input.question, intent.requiresList);
    const resultRows = result.rows?.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value ?? null])));
    updateConversationMemory(input.sessionId, {
      lastCategory: intent.entities.category,
      lastFacilityName: intent.entities.facilityName,
      lastIntent: intent.intent,
      lastLGA: intent.entities.lga,
      lastResultSet: resultRows,
    });
    return {
      actions: [{ description: "Open portal scan intelligence", href: "/portal-scan", label: "Open Portal Scan", source: "portal" }],
      answer: result.answer,
      confidence: intent.confidence,
      intent,
      rows: resultRows,
      sources: sourceStatus,
      summary: result.summary as Record<string, unknown>,
    };
  }

  if (sources.includes("portal_cache") && (sectorFromQuestion(input.question) || workflowStatusFromQuestion(input.question))) {
    const result = portalWorkflowAnswer(input.question, intent.requiresList);
    answer = result.answer;
    rows = result.rows;
    Object.assign(summary, result.summary);
    const resultRows = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, compactValue(value)])));
    updateConversationMemory(input.sessionId, {
      lastCategory: intent.entities.category,
      lastFacilityName: intent.entities.facilityName,
      lastIntent: intent.intent,
      lastLGA: intent.entities.lga,
      lastResultSet: resultRows,
    });
    return {
      actions: buildActions(input.question, intent),
      answer,
      confidence: intent.confidence,
      intent,
      rows: resultRows,
      sources: sourceStatus,
      summary,
    };
  }

  switch (intent.intent) {
    case "notification_document_queried":
    case "notification_final_approval_pending": {
      const result = portalWorkflowAnswer(input.question, intent.requiresList);
      answer = result.answer;
      rows = result.rows;
      Object.assign(summary, result.summary);
      break;
    }
    case "notification_reminders_today":
    case "notification_hefamaa_action":
    case "notification_overdue_renewal":
    case "notification_stale_cache":
    case "notification_changed_status": {
      const result = notificationAnswer(intent);
      if (result) {
        answer = result.answer;
        rows = result.rows;
        Object.assign(summary, result.summary);
      }
      break;
    }
    case "count_facilities": {
      const sourceRows = portalRows.length && sources.includes("portal_cache") ? portalRows : workbookRows;
      answer = "I found " + sourceRows.length.toLocaleString() + " matching facilit" + (sourceRows.length === 1 ? "y" : "ies") + (intent.entities.category ? " in " + intent.entities.category : "") + (intent.entities.lga ? " for " + intent.entities.lga + " LGA" : "") + ".";
      summary.count = sourceRows.length;
      break;
    }
    case "list_facilities": {
      rows = (portalRows.length && sources.includes("portal_cache") ? portalRows.slice(0, 50).map(publicPortalRow) : workbookRows.slice(0, 50).map(publicWorkbookRow));
      answer = "I found " + (portalRows.length || workbookRows.length).toLocaleString() + " matching facilities. Showing the first " + rows.length + ".";
      break;
    }
    case "search_facility":
    case "facility_details": {
      const result = detailAnswerFromRows(input.question, { portal: portalRows, workbook: workbookRows }, intent);
      answer = result.answer;
      rows = result.rows;
      break;
    }
    case "count_by_category": {
      rows = (sources.includes("portal_cache") ? countBy(portalRows, (row) => row.category) : countBy(workbookRows, (row) => row.category)).map((row) => ({ Category: row.label, Count: row.count }));
      answer = "I grouped the matching records by category. " + rows.length + " categor" + (rows.length === 1 ? "y" : "ies") + " were found.";
      break;
    }
    case "count_by_lga": {
      rows = (sources.includes("portal_cache") ? countBy(portalRows, (row) => row.lga) : countBy(workbookRows, (row) => row.lga)).map((row) => ({ LGA: row.label, Count: row.count }));
      answer = "I grouped the matching records by LGA. " + rows.length + " LGA group" + (rows.length === 1 ? "" : "s") + " were found.";
      break;
    }
    case "count_missing_fields": {
      const count = missingFieldCount(workbookRows, intent.entities.field);
      answer = count.toLocaleString() + " matching spreadsheet record" + (count === 1 ? " has" : "s have") + " missing or incomplete " + (intent.entities.field || "core contact/address") + " data.";
      summary.count = count;
      break;
    }
    case "count_pending_requirements": {
      const count = portalRows.filter(isPendingRequirements).length;
      answer = count.toLocaleString() + " matching portal record" + (count === 1 ? " has" : "s have") + " pending or queried requirements.";
      summary.count = count;
      break;
    }
    case "list_pending_requirements": {
      const pending = portalRows.filter(isPendingRequirements);
      rows = pending.slice(0, 50).map(publicPortalRow);
      answer = "I found " + pending.length.toLocaleString() + " portal record(s) with pending or queried requirements. Showing the first " + rows.length + ".";
      break;
    }
    case "count_expired_accreditation": {
      const count = portalRows.filter(isExpiredAccreditation).length;
      answer = count.toLocaleString() + " matching portal record(s) appear to have expired accreditation wording in the cache.";
      summary.count = count;
      break;
    }
    case "list_expired_accreditation": {
      const expired = portalRows.filter(isExpiredAccreditation);
      rows = expired.slice(0, 50).map(publicPortalRow);
      answer = "I found " + expired.length.toLocaleString() + " matching portal record(s) with expired accreditation wording. Showing the first " + rows.length + ".";
      break;
    }
    case "count_staff": {
      const metric = staffMetric(intent);
      const count = portalRows.reduce((sum, row) => sum + metric.reader(row), 0);
      answer = "The matching portal cache records contain " + count.toLocaleString() + " " + metric.label + ".";
      summary.count = count;
      break;
    }
    case "bed_distribution": {
      const type = bedTypeFromField(intent.entities.field) ?? "admissionBeds";
      if (intent.entities.facilityName || intent.entities.hefNo) {
        const lookup = intent.entities.facilityName || intent.entities.hefNo || "";
        const bedResult = getBedsForFacility(lookup, portalRows.length ? portalRows : readPortalCacheRows());
        if (!bedResult) {
          answer = "I could not find a portal cache record for " + lookup + ". Run Full Detail Scan or verify the facility name/code, then try again.";
          rows = [];
          summary.lookup = lookup;
        } else {
          const name = bedResult.row.facility_name || lookup;
          const observationText = bedResult.observationBeds === null ? "not captured" : bedResult.observationBeds.toLocaleString();
          const couchesText = bedResult.couches === null ? "not captured" : bedResult.couches.toLocaleString();
          const admissionText = bedResult.admissionBeds === null ? "not captured" : bedResult.admissionBeds.toLocaleString();
          answer = name + " has " + observationText + " observation beds, " + couchesText + " couches, and " + admissionText + " admission beds recorded." + (bedResult.missingFields.length ? " Some bed fields are missing in the captured portal data; missing values are not treated as 0." : "");
          rows = [publicPortalRow(bedResult.row)];
          Object.assign(summary, bedResult);
        }
      } else if (intent.entities.lga || /grouped by lga|by lga|each local government|by local government/i.test(input.question)) {
        const grouped = getBedsByLGA(type, intent.entities.lga, portalRows.length ? portalRows : readPortalCacheRows(), { category: intent.entities.category, lcda: intent.entities.lcda });
        rows = grouped.slice(0, 50).map((row) => ({ LGA: row.lga, [bedLabel(type)]: row.total, Facilities: row.facilities, "Missing Bed Data": row.missingFacilities }));
        const first = grouped[0];
        answer = intent.entities.lga && first
          ? intent.entities.lga + " LGA has " + first.total.toLocaleString() + " " + bedLabel(type) + " across " + first.facilities.toLocaleString() + " scanned facilities." + (first.missingFacilities ? " Some facilities have missing bed data." : "")
          : "I grouped " + bedLabel(type) + " by LGA across the portal cache. Showing " + rows.length.toLocaleString() + " LGA group(s)." + (grouped.some((row) => row.missingFacilities > 0) ? " Some facilities have missing bed data." : "");
        summary.groups = grouped.length;
      } else {
        const total = getTotalBeds(type, portalRows.length ? portalRows : readPortalCacheRows(), { category: intent.entities.category, lcda: intent.entities.lcda, lga: intent.entities.lga });
        answer = "There are " + total.total.toLocaleString() + " " + bedLabel(type) + " recorded across " + total.facilities.toLocaleString() + " scanned facilities." + (total.missingFacilities ? " Note: " + total.missingFacilities.toLocaleString() + " facilities have missing " + bedLabel(type) + " data." : "");
        Object.assign(summary, total);
      }
      break;
    }
    case "recent_updates": {
      const recent = portalRows.filter((row) => row.captured_at).sort((a, b) => clean(b.captured_at).localeCompare(clean(a.captured_at)));
      rows = recent.slice(0, 25).map(publicPortalRow);
      answer = "These are the most recent captured portal records in the current filters.";
      break;
    }
    case "notification_targets": {
      const targets = portalRows.filter((row) => isPendingRequirements(row) || !row.email || !row.contact).slice(0, 50);
      rows = targets.map(publicPortalRow);
      answer = "I found " + targets.length + " likely notification target(s). I will only preview recipients and message first; sending requires confirmation in the Notification Centre.";
      break;
    }
    case "duplicate_check": {
      const seen = new Map<string, WorkbookKnowledgeRow[]>();
      for (const row of workbookRows) {
        const key = normalize([row.hefNo, row.facilityName, row.address, row.contact].filter(Boolean).join("|"));
        if (!key) continue;
        seen.set(key, [...(seen.get(key) ?? []), row]);
      }
      const duplicateGroups = [...seen.values()].filter((group) => group.length > 1);
      rows = duplicateGroups.flatMap((group) => group.map(publicWorkbookRow)).slice(0, 50);
      answer = "I found " + duplicateGroups.length.toLocaleString() + " possible duplicate group(s) in the matching spreadsheet records.";
      break;
    }
    case "generate_report":
    case "compare_categories": {
      rows = (portalRows.length
        ? countBy(portalRows, (row) => row.category)
        : countBy(workbookRows, (row) => row.category)
      ).map((row) => ({ Category: row.label, Count: row.count }));
      answer = "I prepared a category summary report from the selected source. Export actions are available where the UI supports the filter.";
      break;
    }
    default: {
      if (portalRows.length || workbookRows.length) {
        rows = [...portalRows.slice(0, 8).map(publicPortalRow), ...workbookRows.slice(0, 8).map(publicWorkbookRow)];
        answer = "I found related records, but the exact intent is unclear. Showing the strongest matches.";
      }
    }
  }

  const resultRows = rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, compactValue(value)])));
  updateConversationMemory(input.sessionId, {
    lastCategory: intent.entities.category,
    lastFacilityName: intent.entities.facilityName,
    lastIntent: intent.intent,
    lastLGA: intent.entities.lga,
    lastResultSet: resultRows,
  });

  return {
    actions: buildActions(input.question, intent),
    answer,
    confidence: intent.confidence,
    intent,
    rows: resultRows,
    sources: sourceStatus,
    summary,
  };
}
