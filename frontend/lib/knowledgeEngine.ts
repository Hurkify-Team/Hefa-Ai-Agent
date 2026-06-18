import { getConversationMemory, updateConversationMemory } from "@/lib/conversationMemory";
import { routeDataSources, type KnowledgeDataSource } from "@/lib/dataSourceRouter";
import { detectIntent, type DetectedIntent } from "@/lib/intentDetector";
import { buildNotificationIntelligence } from "@/lib/notificationEngine";
import { normalizeFacilityName, normalizeHeaderName, normalizeLGA } from "@/lib/normalizers";
import { portalRowMatchesText, readPortalCacheRows, type PortalCacheRow } from "@/lib/portalCacheModel";
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
  hefNo: ["HEF/NO", "HEF NO", "HEFAMAA NO", "HF NO", "REG NO", "Registration Number", "Facility Code", "FACILITY CODE"],
  lga: ["LGA", "Local Government"],
};

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

function filterPortal(rows: PortalCacheRow[], intent: DetectedIntent) {
  const entity = intent.entities;
  return rows.filter((row) => {
    if (!categoryMatches(row.category, entity.category)) return false;
    if (!lgaMatches(row.lga, entity.lga)) return false;
    if (!statusMatches(row.registration_status, entity.status)) return false;
    if (entity.facilityName && !portalRowMatchesText(row, entity.facilityName)) return false;
    if (entity.hefNo && normalize(row.hef_no) !== normalize(entity.hefNo)) return false;
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
    "Captured At": row.captured_at,
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
      medical_professional_in_charge: ["operating officer / medical professional in-charge", portal.structured_portal_data?.visibleFields && typeof portal.structured_portal_data.visibleFields === "object" ? (portal.structured_portal_data.visibleFields as Record<string, unknown>)["Medical Professional In-Charge"] : portal.owner_name],
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
      workbookRows = filterWorkbook(await readAllWorkbookRows(), intent);
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

  switch (intent.intent) {
    case "notification_document_queried":
    case "notification_reminders_today":
    case "notification_hefamaa_action":
    case "notification_final_approval_pending":
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
