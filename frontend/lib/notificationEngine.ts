import { existsSync, readFileSync, statSync, writeFileSync } from "fs";

import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";
import { z } from "zod";

import { sourceMissingPortalContacts } from "@/lib/contactSourcing";
import { sendEmailNotification } from "@/lib/emailProvider";
import { buildPortalCacheFreshnessPlan } from "@/lib/portalCacheFreshness";
import { readPortalCacheRows, type PortalCacheRow } from "@/lib/portalCacheModel";
import { listNotificationRules, saveNotificationRule } from "@/lib/notificationRules";
import { schedulerSummary } from "@/lib/notificationScheduler";
import { DEFAULT_NOTIFICATION_TEMPLATES, renderTemplate, templateFor, type NotificationTemplateId } from "@/lib/notificationTemplates";
import { sendSmsNotification } from "@/lib/smsProvider";

export const notificationChannelSchema = z.enum(["email", "sms"]);
export const notificationTypeSchema = z.enum([
  "pending_requirements",
  "expired_accreditation",
  "missing_documents",
  "inspection_reminder",
  "general_notice",
  "incomplete_record",
  "provisional_license_ready",
]);

export const MAX_NOTIFICATION_RECIPIENTS = 20000;

export const notificationPreviewRequestSchema = z.object({
  category: z.string().trim().optional().or(z.literal("")),
  channels: z.array(notificationChannelSchema).min(1).default(["email"]),
  customMessage: z.string().trim().optional().or(z.literal("")),
  customSubject: z.string().trim().optional().or(z.literal("")),
  deadline: z.string().trim().optional().or(z.literal("")),
  facilityQuery: z.string().trim().optional().or(z.literal("")),
  forceSend: z.boolean().default(false),
  includeNotDue: z.boolean().default(false),
  lga: z.string().trim().optional().or(z.literal("")),
  limit: z.coerce.number().int().min(1).max(MAX_NOTIFICATION_RECIPIENTS).default(100),
  notificationType: notificationTypeSchema.default("pending_requirements"),
  portalLink: z.string().trim().optional().or(z.literal("")),
  selectedRecipientIds: z.array(z.string()).optional(),
  status: z.string().trim().optional().or(z.literal("")),
  templateId: z.string().trim().optional().or(z.literal("")),
});

export const notificationSendRequestSchema = notificationPreviewRequestSchema.extend({
  confirmed: z.boolean().default(false),
  createdBy: z.string().trim().default("Admin User"),
});

const dailyScanRequestSchema = notificationSendRequestSchema.partial().extend({
  channels: z.array(notificationChannelSchema).min(1).default(["email", "sms"]),
  confirmed: z.boolean().default(false),
  createdBy: z.string().trim().default("HEFA-AI Daily Scan"),
  limit: z.coerce.number().int().min(1).max(MAX_NOTIFICATION_RECIPIENTS).default(100),
});

const notificationFacilityListRequestSchema = z.object({
  category: z.string().trim().optional().or(z.literal("")),
  dueOnly: z.preprocess((value) => value === true || value === "true" || value === "1", z.boolean()).default(false),
  facilityQuery: z.string().trim().optional().or(z.literal("")),
  lga: z.string().trim().optional().or(z.literal("")),
  limit: z.coerce.number().int().min(1).max(MAX_NOTIFICATION_RECIPIENTS).default(MAX_NOTIFICATION_RECIPIENTS),
  owner: z.enum(["all", "facility", "hefamaa"]).default("all"),
  status: z.string().trim().optional().or(z.literal("")),
});

const contactSourcingRequestSchema = z.object({
  category: z.string().trim().optional().or(z.literal("")),
  dueOnly: z.boolean().default(false),
  facilityQuery: z.string().trim().optional().or(z.literal("")),
  includeSheets: z.boolean().default(false),
  limit: z.coerce.number().int().min(1).max(MAX_NOTIFICATION_RECIPIENTS).default(MAX_NOTIFICATION_RECIPIENTS),
  owner: z.enum(["all", "facility", "hefamaa"]).default("facility"),
  status: z.string().trim().optional().or(z.literal("")),
});

const notificationFailureResolutionSchema = z.object({
  channel: z.enum(["all", "email", "sms"]).default("all"),
  createdBy: z.string().trim().min(1).default("Admin User"),
  note: z.string().trim().max(400).default("Resolved historical provider failure after provider configuration review."),
});

export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationType = z.infer<typeof notificationTypeSchema>;
export type NotificationPreviewRequest = z.infer<typeof notificationPreviewRequestSchema>;
export type NotificationSendRequest = z.infer<typeof notificationSendRequestSchema>;

export type NotificationStatusKey =
  | "DOCUMENT_QUERIED"
  | "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING"
  | "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING"
  | "FINAL_APPROVAL_PENDING"
  | "RENEWAL_OVERDUE";

type CachePolicy = "fresh" | "background_verification" | "live_verification_required";
type VerificationRequirement = "none" | "background" | "before_send";
type NextActionOwner = "facility" | "hefamaa" | "unknown";

export type NotificationRecipient = {
  attention_type?: NotificationStatusKey;
  cache_age_days?: number | null;
  cache_policy?: CachePolicy;
  category: string;
  contact_email: string;
  contact_phone: string;
  days_pending?: number | null;
  facility_name: string;
  hef_no: string;
  id: string;
  last_activity_date?: string | null;
  last_reminder_at?: string | null;
  lga: string;
  missing_requirements: string;
  next_action_owner?: NextActionOwner;
  next_reminder_at?: string | null;
  owner_name: string;
  portal_status: string;
  reason: string;
  reminder_block_reason?: string | null;
  reminder_due?: boolean;
  reminder_policy?: string;
  source_url: string;
  verification_reason?: string;
  verification_required?: VerificationRequirement;
};

export type NotificationLog = {
  category: string;
  channel: NotificationChannel;
  contact_email: string;
  contact_phone: string;
  created_at: string;
  created_by: string;
  facility_name: string;
  hef_no: string;
  id: string;
  lga: string;
  message: string;
  notification_type: NotificationType;
  original_status?: "pending" | "sent" | "failed" | "skipped";
  provider_response: string;
  resolution_note?: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
  sent_at: string | null;
  status: "pending" | "sent" | "failed" | "skipped" | "resolved";
  subject: string;
  verification_status?: string;
};

type VerificationRecord = {
  checked_at: string;
  facility_name: string;
  old_status: string;
  new_status: string;
  status_changed: boolean;
  result: "confirmed_facility_action" | "hefamaa_action" | "no_action" | "failed";
  reason: string;
};

type NotificationStore = { logs: NotificationLog[]; verifications?: VerificationRecord[] };
type NotificationEvaluationContext = {
  historyByFacility: Map<string, NotificationLog[]>;
  latestVerificationByFacility: Map<string, VerificationRecord>;
  store: NotificationStore;
};

let notificationIntelligenceCache: { createdAt: number; limit: number; value: any } | null = null;
let evaluatedNotificationCache: { createdAt: number; value: EvaluatedNotificationRow[] } | null = null;
let notificationDashboardCache: { compact: boolean; createdAt: number; value: any } | null = null;

function notificationCacheTtlMs() {
  return Number(process.env.NOTIFICATION_INTELLIGENCE_CACHE_TTL_MS || 300000);
}

function invalidateNotificationCaches() {
  notificationIntelligenceCache = null;
  evaluatedNotificationCache = null;
  notificationDashboardCache = null;
}

type EvaluatedNotificationRow = {
  cache_age_days: number | null;
  cache_policy: CachePolicy;
  category: string;
  contact_email: string;
  contact_phone: string;
  days_pending: number | null;
  facility_name: string;
  hef_no: string;
  id: string;
  last_activity_date: string | null;
  last_reminder_at: string | null;
  lga: string;
  next_action_owner: NextActionOwner;
  next_reminder_at: string | null;
  owner_name: string;
  portal_status: string;
  priority: "critical" | "high" | "normal";
  reason: string;
  reminder_block_reason: string | null;
  reminder_due: boolean;
  reminder_policy: string;
  source_url: string;
  status_key: NotificationStatusKey;
  verification_required: VerificationRequirement;
  verification_reason: string;
};

const MONITORED_STATUS_LABELS: Record<Exclude<NotificationStatusKey, "RENEWAL_OVERDUE">, string> = {
  DOCUMENT_QUERIED: "Document Queried",
  FINAL_APPROVAL_PENDING: "Final Approval Pending",
  PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: "Payment Approved Document Approval Pending",
  UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: "Upload Payment Approval Pending",
};

const STATUS_RANK: Record<NotificationStatusKey, number> = {
  DOCUMENT_QUERIED: 0,
  RENEWAL_OVERDUE: 1,
  UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: 2,
  PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: 3,
  FINAL_APPROVAL_PENDING: 4,
};

const MONTHS: Record<string, number> = {
  april: 3,
  apr: 3,
  august: 7,
  aug: 7,
  december: 11,
  dec: 11,
  february: 1,
  feb: 1,
  january: 0,
  jan: 0,
  july: 6,
  jul: 6,
  june: 5,
  jun: 5,
  march: 2,
  mar: 2,
  may: 4,
  november: 10,
  nov: 10,
  october: 9,
  oct: 9,
  september: 8,
  sept: 8,
  sep: 8,
};

function storePath() {
  return configuredRuntimeFile("NOTIFICATION_LOGS_PATH", "notification-logs.json");
}

function dataPath(envName: string, fallback: string) {
  return configuredRuntimeFile(envName, fallback);
}

function fileMtimeMs(file: string) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function compactDashboardCachePath() {
  return dataPath("NOTIFICATION_DASHBOARD_CACHE_PATH", "data/notification-dashboard-cache.json");
}

function compactDashboardDeps() {
  return {
    notificationLogsMtimeMs: fileMtimeMs(storePath()),
    portalListMtimeMs: fileMtimeMs(dataPath("HEFAMAA_PORTAL_CACHE", "data/portal-facilities-cache.json")),
    portalQaMtimeMs: fileMtimeMs(dataPath("HEFAMAA_PORTAL_QA_INDEX", "data/portal-qa-index.json")),
  };
}

function readCompactDashboardCache(deps: ReturnType<typeof compactDashboardDeps>) {
  const file = compactDashboardCachePath();
  if (!existsSync(file)) return null;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    const ttlMs = notificationCacheTtlMs();
    const fresh = parsed?.version === 1
      && parsed?.deps?.notificationLogsMtimeMs === deps.notificationLogsMtimeMs
      && parsed?.deps?.portalListMtimeMs === deps.portalListMtimeMs
      && parsed?.deps?.portalQaMtimeMs === deps.portalQaMtimeMs
      && Date.now() - Number(parsed.createdAtMs || 0) <= ttlMs;
    return fresh ? parsed.dashboard : null;
  } catch {
    return null;
  }
}

function writeCompactDashboardCache(deps: ReturnType<typeof compactDashboardDeps>, dashboard: unknown) {
  const file = compactDashboardCachePath();
  try {
    ensureRuntimeDataDirForFile(file);
    writeFileSync(file, JSON.stringify({ createdAtMs: Date.now(), dashboard, deps, version: 1 }), "utf8");
  } catch {
    // The in-memory dashboard cache still works if the file snapshot cannot be written.
  }
}

function readStore(): NotificationStore {
  const file = storePath();
  if (!existsSync(file)) return { logs: [], verifications: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return {
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      verifications: Array.isArray(parsed.verifications) ? parsed.verifications : [],
    };
  } catch {
    return { logs: [], verifications: [] };
  }
}

function writeStore(store: NotificationStore) {
  const file = storePath();
  ensureRuntimeDataDirForFile(file);
  writeFileSync(file, JSON.stringify({ logs: store.logs, verifications: store.verifications ?? [] }, null, 2), "utf8");
  invalidateNotificationCaches();
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactDate(value: Date | null) {
  return value && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function daysBetween(older: Date | null, newer = new Date()) {
  if (!older || !Number.isFinite(older.getTime())) return null;
  return Math.max(0, (newer.getTime() - older.getTime()) / (24 * 60 * 60 * 1000));
}

function parseDateValue(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const direct = new Date(text);
  if (Number.isFinite(direct.getTime())) return direct;

  const named = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?[-/\s]+([A-Za-z]+)[-/\s]+(20\d{2})\b/i);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month !== undefined) return new Date(Number(named[3]), month, Number(named[1]));
  }

  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const year = Number(numeric[3]);
    const month = first > 12 ? second - 1 : first - 1;
    const day = first > 12 ? first : second;
    return new Date(year, month, day);
  }

  return null;
}

function dateMatchesFromText(text: string) {
  const dates: Date[] = [];
  const patterns = [
    /\b20\d{2}-\d{1,2}-\d{1,2}\b/g,
    /\b\d{1,2}(?:st|nd|rd|th)?[-/\s]+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t)?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[-/\s]+20\d{2}\b/gi,
    /\b\d{1,2}[/-]\d{1,2}[/-]20\d{2}\b/g,
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const parsed = parseDateValue(match[0]);
      if (parsed && parsed.getFullYear() >= 2015 && parsed.getFullYear() <= new Date().getFullYear() + 1) {
        dates.push(parsed);
      }
    }
  }
  return dates;
}

function latestDate(dates: Date[]) {
  return dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : null;
}

function extractLastActivityDate(row: PortalCacheRow) {
  const text = clean(row.raw_portal_text);
  const visibleFields = row.structured_portal_data?.visibleFields;
  const qaFields = row.structured_portal_data?.qaFields;
  const fieldObjects = [visibleFields, qaFields].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));

  const labelledCandidates = [
    "last activity date",
    "activity date",
    "application date",
    "record date",
    "registration date",
    "renewal date",
    "date registered",
    "date of approval",
    "date approved",
  ];

  for (const fields of fieldObjects) {
    for (const [key, value] of Object.entries(fields)) {
      if (!labelledCandidates.some((label) => normalize(key).includes(normalize(label)))) continue;
      const parsed = parseDateValue(value);
      if (parsed) return parsed;
    }
  }

  if (!text) return null;

  // In HEFAMAA portal captures, the facility workflow date normally appears
  // near the top of the record before the detailed facility profile. Prefer
  // that area so the establishment date does not get mistaken for activity.
  const beforeDetails = text.split(/FACILITY DETAILS|Facility Information|CONTACT DETAILS/i)[0] || text.slice(0, 1600);
  const topDate = latestDate(dateMatchesFromText(beforeDetails));
  if (topDate) return topDate;

  const status = clean(row.registration_status);
  if (status) {
    const statusIndex = normalize(text).indexOf(normalize(status));
    if (statusIndex >= 0) {
      const window = text.slice(Math.max(0, statusIndex - 600), statusIndex + 600);
      const statusDate = latestDate(dateMatchesFromText(window));
      if (statusDate) return statusDate;
    }
  }

  return latestDate(dateMatchesFromText(text));
}

function statusKeyFor(row: PortalCacheRow): Exclude<NotificationStatusKey, "RENEWAL_OVERDUE"> | null {
  const text = normalize([row.registration_status, row.requirements_status, row.inspection_status, row.accreditation_status].join(" "));
  if (/document(s)? queried|document query|queried/.test(text)) return "DOCUMENT_QUERIED";
  if (/upload payment.*pending document|payment upload.*pending document|upload payment/.test(text)) return "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING";
  if (/payment approved.*pending document|payment confirmed.*pending document/.test(text)) return "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING";
  if (/final approval pending/.test(text)) return "FINAL_APPROVAL_PENDING";
  return null;
}

function cacheAgeDate(row: PortalCacheRow) {
  return parseDateValue(row.updated_at) ?? parseDateValue(row.captured_at);
}

function renewalYearFor(row: PortalCacheRow) {
  const data = row.structured_portal_data ?? {};
  const candidates = [
    data.renewalYear,
    (data.sourceRecord as Record<string, unknown> | undefined)?.renewalYear,
    (data.selectedPortalRecord as Record<string, unknown> | undefined)?.renewalYear,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isInteger(numeric) && numeric >= 2015 && numeric <= new Date().getFullYear() + 1) return numeric;
  }
  return null;
}

function cachePolicyFor(ageDays: number | null): { policy: CachePolicy; requirement: VerificationRequirement; reason: string } {
  if (ageDays === null) {
    return { policy: "live_verification_required", requirement: "before_send", reason: "No reliable cache timestamp exists, so the live portal must verify status before sending." };
  }
  if (ageDays <= 3) {
    return { policy: "fresh", requirement: "none", reason: "Cache is 3 days old or newer." };
  }
  if (ageDays <= 7) {
    return { policy: "background_verification", requirement: "background", reason: "Cache is older than 3 days, so a background portal verification should refresh it." };
  }
  return { policy: "live_verification_required", requirement: "before_send", reason: "Cache is older than 7 days; the portal must verify status before any reminder is sent." };
}

function isAfterRenewalWindow(now = new Date()) {
  const renewalWindowEnds = new Date(now.getFullYear(), 2, 31, 23, 59, 59, 999);
  return now.getTime() > renewalWindowEnds.getTime();
}

function logTime(log: NotificationLog) {
  return parseDateValue(log.sent_at || log.created_at);
}

function buildEvaluationContext(store: NotificationStore): NotificationEvaluationContext {
  const historyByFacility = new Map<string, NotificationLog[]>();
  const latestVerificationByFacility = new Map<string, VerificationRecord>();

  for (const log of store.logs) {
    if (log.notification_type !== "pending_requirements" || !["sent", "pending"].includes(log.status)) continue;
    const facility = normalize(log.facility_name);
    if (!facility) continue;
    const history = historyByFacility.get(facility) ?? [];
    history.push(log);
    historyByFacility.set(facility, history);
  }

  for (const history of historyByFacility.values()) {
    history.sort((a, b) => (logTime(b)?.getTime() ?? 0) - (logTime(a)?.getTime() ?? 0));
  }

  for (const verification of store.verifications ?? []) {
    if (verification.result === "failed") continue;
    const facility = normalize(verification.facility_name);
    if (!facility) continue;
    const existing = latestVerificationByFacility.get(facility);
    if (!existing || Date.parse(verification.checked_at) > Date.parse(existing.checked_at)) {
      latestVerificationByFacility.set(facility, verification);
    }
  }

  return { historyByFacility, latestVerificationByFacility, store };
}

function ensureEvaluationContext(contextOrStore: NotificationEvaluationContext | NotificationStore) {
  return "historyByFacility" in contextOrStore ? contextOrStore : buildEvaluationContext(contextOrStore);
}

function reminderHistoryFor(contextOrStore: NotificationEvaluationContext | NotificationStore, row: PortalCacheRow) {
  const facility = normalize(row.facility_name);
  if (!facility) return [];
  const context = ensureEvaluationContext(contextOrStore);
  return context.historyByFacility.get(facility) ?? [];
}

function latestReminderAt(history: NotificationLog[]) {
  const latest = history.map(logTime).find((date): date is Date => Boolean(date));
  return compactDate(latest ?? null);
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function startOfWeekMonday(now: Date) {
  const start = new Date(now);
  const day = start.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  start.setDate(start.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function nextAllowedWeekday(now: Date, allowedDays: number[]) {
  for (let offset = 1; offset <= 7; offset += 1) {
    const candidate = new Date(now);
    candidate.setDate(now.getDate() + offset);
    candidate.setHours(9, 0, 0, 0);
    if (allowedDays.includes(candidate.getDay())) return candidate;
  }
  return addHours(now, 24);
}

function daysPendingSince(activityDate: Date | null, now: Date) {
  const age = daysBetween(activityDate, now);
  return age === null ? null : Math.floor(age);
}

function latestVerificationFor(contextOrStore: NotificationEvaluationContext | NotificationStore, row: PortalCacheRow) {
  const facility = normalize(row.facility_name);
  if (!facility) return null;
  const context = ensureEvaluationContext(contextOrStore);
  return context.latestVerificationByFacility.get(facility) ?? null;
}

function rowWithVerificationOverride(row: PortalCacheRow, contextOrStore: NotificationEvaluationContext | NotificationStore): PortalCacheRow {
  const verification = latestVerificationFor(contextOrStore, row);
  if (!verification?.new_status) return row;
  return {
    ...row,
    registration_status: verification.new_status,
    updated_at: verification.checked_at || row.updated_at,
  };
}

function cadenceForStatus(statusKey: NotificationStatusKey, history: NotificationLog[], now = new Date()) {
  const lastDate = history.map(logTime).find((date): date is Date => Boolean(date)) ?? null;
  const lastReminderAt = compactDate(lastDate);
  const hoursSinceLast = lastDate ? (now.getTime() - lastDate.getTime()) / (60 * 60 * 1000) : Number.POSITIVE_INFINITY;

  if (statusKey === "DOCUMENT_QUERIED") {
    const allowedDays = [1, 3, 5];
    const policy = "Monday, Wednesday, Friday; maximum 3 reminders per week; minimum 48 hours between reminders.";
    if (!allowedDays.includes(now.getDay())) {
      return { due: false, lastReminderAt, nextReminderAt: compactDate(nextAllowedWeekday(now, allowedDays)), policy, reason: "Document query reminders are only sent on Monday, Wednesday, and Friday." };
    }
    if (lastDate && hoursSinceLast < 48) {
      return { due: false, lastReminderAt, nextReminderAt: compactDate(addHours(lastDate, 48)), policy, reason: "A document query reminder was sent less than 48 hours ago." };
    }
    const weekStart = startOfWeekMonday(now);
    const weeklyCount = history.filter((log) => {
      const date = logTime(log);
      return date && date >= weekStart && date <= now;
    }).length;
    if (weeklyCount >= 3) {
      const nextWeek = new Date(weekStart);
      nextWeek.setDate(weekStart.getDate() + 7);
      nextWeek.setHours(9, 0, 0, 0);
      return { due: false, lastReminderAt, nextReminderAt: compactDate(nextWeek), policy, reason: "The maximum of 3 document query reminders has already been reached this week." };
    }
    return { due: true, lastReminderAt, nextReminderAt: null, policy, reason: null };
  }

  if (statusKey === "RENEWAL_OVERDUE") {
    const policy = "Every Monday during renewal follow-up.";
    if (now.getDay() !== 1) {
      return { due: false, lastReminderAt, nextReminderAt: compactDate(nextAllowedWeekday(now, [1])), policy, reason: "Annual renewal reminders are only sent on Monday." };
    }
    if (lastDate && hoursSinceLast < 7 * 24) {
      return { due: false, lastReminderAt, nextReminderAt: compactDate(addHours(lastDate, 7 * 24)), policy, reason: "A renewal reminder was already sent within the last 7 days." };
    }
    return { due: true, lastReminderAt, nextReminderAt: null, policy, reason: null };
  }

  const policy = "Every 14 days for unresolved previous-year workflow statuses.";
  if (lastDate && hoursSinceLast < 14 * 24) {
    return { due: false, lastReminderAt, nextReminderAt: compactDate(addHours(lastDate, 14 * 24)), policy, reason: "This status is on a 14-day reminder cycle." };
  }
  return { due: true, lastReminderAt, nextReminderAt: null, policy, reason: null };
}

function publicIntelligenceRow(item: EvaluatedNotificationRow) {
  return {
    "Cache Age Days": item.cache_age_days === null ? "Unknown" : Number(item.cache_age_days.toFixed(1)),
    "Cache Policy": item.cache_policy,
    Category: item.category,
    "Recipient ID": item.id,
    "Facility Name": item.facility_name,
    "HEF/NO / Portal ID": item.hef_no,
    "Days Pending": item.days_pending,
    "Last Activity Date": item.last_activity_date,
    LGA: item.lga,
    "Next Action Owner": item.next_action_owner,
    "Next Reminder At": item.next_reminder_at,
    Priority: item.priority,
    Reason: item.reason,
    "Reminder Block Reason": item.reminder_block_reason,
    "Reminder Policy": item.reminder_policy,
    "Reminder Due": item.reminder_due,
    Status: item.portal_status,
    "Status Key": item.status_key,
    "Verification Required": item.verification_required,
    "Email Available": Boolean(item.contact_email),
    "Phone Available": Boolean(item.contact_phone),
  };
}

function compactNotificationIntelligence(intelligence: ReturnType<typeof buildNotificationIntelligence>) {
  return {
    attentionCards: intelligence.attentionCards,
    backgroundVerificationCount: intelligence.backgroundVerificationCount,
    changedAfterVerificationCount: intelligence.changedAfterVerificationCount,
    delivery: intelligence.delivery,
    evaluatedCount: intelligence.evaluatedCount,
    generatedAt: intelligence.generatedAt,
    hefamaaAttention: intelligence.hefamaaAttention,
    hefamaaAttentionCount: intelligence.hefamaaAttentionCount,
    reminderQueue: intelligence.reminderQueue,
    reminderQueueCount: intelligence.reminderQueueCount,
    renewalOverdueCount: intelligence.renewalOverdueCount,
    staleCacheBlockedCount: intelligence.staleCacheBlockedCount,
    staleCacheCount: intelligence.staleCacheCount,
  };
}

function compactNotificationPreview(preview: ReturnType<typeof previewNotifications>) {
  return {
    duplicateBlocked: preview.duplicateBlocked,
    delivery: preview.delivery,
    intelligence: compactNotificationIntelligence(preview.intelligence),
    messages: preview.messages.slice(0, 3).map((message) => ({
      blockedByDuplicate: message.blockedByDuplicate,
      blockedByStaleCache: message.blockedByStaleCache,
      channel: message.channel,
      destination: message.destination,
      subject: message.subject,
      templateId: message.templateId,
      verificationNotice: message.verificationNotice,
    })),
    recipientCount: preview.recipientCount,
    requiresConfirmation: preview.requiresConfirmation,
    staleCacheBlocked: preview.staleCacheBlocked,
  };
}

function compactNotificationLog(log: NotificationLog) {
  return {
    channel: log.channel,
    created_at: log.created_at,
    facility_name: log.facility_name,
    id: log.id,
    notification_type: log.notification_type,
    sent_at: log.sent_at,
    status: log.status,
    subject: log.subject,
    verification_status: log.verification_status,
  };
}

function recipientFromEvaluation(item: EvaluatedNotificationRow): NotificationRecipient {
  return {
    attention_type: item.status_key,
    cache_age_days: item.cache_age_days,
    cache_policy: item.cache_policy,
    category: item.category,
    contact_email: item.contact_email,
    contact_phone: item.contact_phone,
    days_pending: item.days_pending,
    facility_name: item.facility_name,
    hef_no: item.hef_no,
    id: item.id,
    last_activity_date: item.last_activity_date,
    last_reminder_at: item.last_reminder_at,
    lga: item.lga,
    missing_requirements: item.reason,
    next_action_owner: item.next_action_owner,
    next_reminder_at: item.next_reminder_at,
    owner_name: item.owner_name,
    portal_status: item.portal_status,
    reason: item.reason,
    reminder_block_reason: item.reminder_block_reason,
    reminder_due: item.reminder_due,
    reminder_policy: item.reminder_policy,
    source_url: item.source_url,
    verification_reason: item.verification_reason,
    verification_required: item.verification_required,
  };
}

function labelForStatusKey(key: NotificationStatusKey | "UNKNOWN") {
  if (key === "UNKNOWN") return "Unknown Status";
  if (key === "RENEWAL_OVERDUE") return "Renewal Overdue";
  return MONITORED_STATUS_LABELS[key] ?? key;
}

function rankForStatusKey(key: string) {
  return key in STATUS_RANK ? STATUS_RANK[key as NotificationStatusKey] : 99;
}

function deliveryStatsForRecipients(recipients: NotificationRecipient[], channels: NotificationChannel[]) {
  const wantsEmail = channels.includes("email");
  const wantsSms = channels.includes("sms");
  const byStatus = new Map<
    string,
    {
      key: string;
      label: string;
      recipientCount: number;
      emailReadyCount: number;
      smsReadyCount: number;
      missingEmailCount: number;
      missingPhoneCount: number;
      deliverableMessageCount: number;
      missingDestinationCount: number;
    }
  >();

  const ensureStatus = (key: string) => {
    const existing = byStatus.get(key);
    if (existing) return existing;
    const row = {
      key,
      label: labelForStatusKey(key as NotificationStatusKey | "UNKNOWN"),
      recipientCount: 0,
      emailReadyCount: 0,
      smsReadyCount: 0,
      missingEmailCount: 0,
      missingPhoneCount: 0,
      deliverableMessageCount: 0,
      missingDestinationCount: 0,
    };
    byStatus.set(key, row);
    return row;
  };

  const totals = {
    recipientCount: recipients.length,
    requestedChannels: channels,
    emailReadyCount: 0,
    smsReadyCount: 0,
    missingEmailCount: 0,
    missingPhoneCount: 0,
    deliverableMessageCount: 0,
    missingDestinationCount: 0,
  };

  for (const recipient of recipients) {
    const key = recipient.attention_type || "UNKNOWN";
    const row = ensureStatus(key);
    const hasEmail = Boolean(recipient.contact_email);
    const hasPhone = Boolean(recipient.contact_phone);
    const deliverableMessages = (wantsEmail && hasEmail ? 1 : 0) + (wantsSms && hasPhone ? 1 : 0);
    const missingDestinations = (wantsEmail && !hasEmail ? 1 : 0) + (wantsSms && !hasPhone ? 1 : 0);

    totals.emailReadyCount += hasEmail ? 1 : 0;
    totals.smsReadyCount += hasPhone ? 1 : 0;
    totals.missingEmailCount += wantsEmail && !hasEmail ? 1 : 0;
    totals.missingPhoneCount += wantsSms && !hasPhone ? 1 : 0;
    totals.deliverableMessageCount += deliverableMessages;
    totals.missingDestinationCount += missingDestinations;

    row.recipientCount += 1;
    row.emailReadyCount += hasEmail ? 1 : 0;
    row.smsReadyCount += hasPhone ? 1 : 0;
    row.missingEmailCount += wantsEmail && !hasEmail ? 1 : 0;
    row.missingPhoneCount += wantsSms && !hasPhone ? 1 : 0;
    row.deliverableMessageCount += deliverableMessages;
    row.missingDestinationCount += missingDestinations;
  }

  return {
    ...totals,
    byStatus: Array.from(byStatus.values()).sort((a, b) => rankForStatusKey(a.key) - rankForStatusKey(b.key)),
  };
}

function evaluateNotificationRow(row: PortalCacheRow, contextOrStore: NotificationEvaluationContext | NotificationStore, now = new Date()): EvaluatedNotificationRow | null {
  const context = ensureEvaluationContext(contextOrStore);
  const effectiveRow = rowWithVerificationOverride(row, context);
  if (!clean(effectiveRow.facility_name)) return null;

  const currentYear = now.getFullYear();
  const statusKey = statusKeyFor(effectiveRow);
  const renewalYear = renewalYearFor(effectiveRow);

  // Date extraction scans raw portal text, so keep it limited to monitored
  // workflow statuses. Renewal overdue can use the portal renewal year from
  // cache metadata and avoid parsing thousands of full detail records.
  const activityDate = statusKey ? extractLastActivityDate(effectiveRow) : null;
  const activityYear = activityDate?.getFullYear() ?? renewalYear;
  const renewalOverdue = !statusKey && isAfterRenewalWindow(now) && activityYear !== null && activityYear < currentYear;
  const finalStatusKey: NotificationStatusKey | null = statusKey ?? (renewalOverdue ? "RENEWAL_OVERDUE" : null);
  if (!finalStatusKey) return null;

  const cacheAgeDays = daysBetween(cacheAgeDate(effectiveRow), now);
  const cachePolicy = cachePolicyFor(cacheAgeDays);
  const history = reminderHistoryFor(context, effectiveRow);
  const cadence = cadenceForStatus(finalStatusKey, history, now);
  let nextActionOwner: NextActionOwner = "facility";
  let priority: EvaluatedNotificationRow["priority"] = "normal";
  let reason = "Facility requires a HEFAMAA notification follow-up.";

  if (finalStatusKey === "DOCUMENT_QUERIED") {
    priority = "critical";
    reason = "Facility documents were queried. The facility is responsible for correcting the query and should receive reminders on Monday, Wednesday, and Friday until the portal status changes.";
  } else if (finalStatusKey === "RENEWAL_OVERDUE") {
    priority = "high";
    reason = "No current-year renewal activity is visible after the January 1 to March 31 renewal window. The facility should receive a renewal reminder.";
  } else if (activityYear === currentYear) {
    nextActionOwner = "hefamaa";
    priority = "high";
    reason = "The facility has current-year activity in this status. The next action belongs to HEFAMAA staff, so no facility reminder should be sent.";
  } else if (activityYear && activityYear < currentYear) {
    priority = "high";
    reason = "The facility entered this status in a previous year and appears unresolved. The facility should receive a reminder.";
  } else {
    priority = "normal";
    reason = "The cache does not show a reliable current-year activity date. Verify stale cache before sending if required.";
  }

  return {
    cache_age_days: cacheAgeDays,
    cache_policy: cachePolicy.policy,
    category: clean(effectiveRow.category),
    contact_email: clean(effectiveRow.email),
    contact_phone: clean(effectiveRow.contact),
    days_pending: daysPendingSince(activityDate, now),
    facility_name: clean(effectiveRow.facility_name),
    hef_no: clean(effectiveRow.hef_no),
    id: effectiveRow.id,
    last_activity_date: compactDate(activityDate),
    last_reminder_at: cadence.lastReminderAt,
    lga: clean(effectiveRow.lga),
    next_action_owner: nextActionOwner,
    next_reminder_at: cadence.nextReminderAt,
    owner_name: clean(effectiveRow.owner_name) || clean(effectiveRow.facility_name) || "Facility Owner",
    portal_status: clean(effectiveRow.registration_status),
    priority,
    reason,
    reminder_block_reason: nextActionOwner === "facility" ? cadence.reason : "HEFAMAA staff owns the next action.",
    reminder_due: nextActionOwner === "facility" && cadence.due,
    reminder_policy: cadence.policy,
    source_url: clean(effectiveRow.source_url),
    status_key: finalStatusKey,
    verification_required: cachePolicy.requirement,
    verification_reason: cachePolicy.reason,
  };
}

function sortEvaluations(rows: EvaluatedNotificationRow[]) {
  return rows.sort((a, b) => {
    const rank = STATUS_RANK[a.status_key] - STATUS_RANK[b.status_key];
    if (rank !== 0) return rank;
    const dateA = a.last_activity_date ? Date.parse(a.last_activity_date) : 0;
    const dateB = b.last_activity_date ? Date.parse(b.last_activity_date) : 0;
    return dateA - dateB || a.facility_name.localeCompare(b.facility_name);
  });
}

function matchesIntelligenceFilter(item: EvaluatedNotificationRow, input: NotificationPreviewRequest) {
  const query = normalize(input.facilityQuery);
  const haystack = normalize([item.facility_name, item.hef_no, item.category, item.lga, item.contact_email, item.contact_phone, item.portal_status, item.status_key].join(" "));
  if (query && !haystack.includes(query)) return false;
  if (input.category && normalize(item.category) !== normalize(input.category)) return false;
  if (input.lga && !normalize(item.lga).includes(normalize(input.lga))) return false;
  if (input.status && !normalize(item.portal_status + " " + item.status_key).includes(normalize(input.status))) return false;
  return true;
}

function evaluatedNotificationRows(store: NotificationStore) {
  const ttlMs = notificationCacheTtlMs();
  if (evaluatedNotificationCache && Date.now() - evaluatedNotificationCache.createdAt <= ttlMs) {
    return evaluatedNotificationCache.value;
  }

  const context = buildEvaluationContext(store);
  const rows = sortEvaluations(
    readPortalCacheRows()
      .map((row) => evaluateNotificationRow(row, context))
      .filter((row): row is EvaluatedNotificationRow => Boolean(row)),
  );
  evaluatedNotificationCache = { createdAt: Date.now(), value: rows };
  return rows;
}

export function buildNotificationIntelligence(options: { limit?: number } = {}) {
  const limit = Math.max(1, Math.min(options.limit ?? 100, MAX_NOTIFICATION_RECIPIENTS));
  const ttlMs = notificationCacheTtlMs();
  if (notificationIntelligenceCache && notificationIntelligenceCache.limit === limit && Date.now() - notificationIntelligenceCache.createdAt <= ttlMs) {
    return notificationIntelligenceCache.value;
  }

  const store = readStore();
  const evaluated = evaluatedNotificationRows(store);
  const reminderQueue = evaluated.filter((row) => row.next_action_owner === "facility" && row.reminder_due);
  const hefamaaAttention = evaluated.filter((row) => row.next_action_owner === "hefamaa");
  const staleCache = evaluated.filter((row) => row.verification_required === "before_send");
  const backgroundVerification = evaluated.filter((row) => row.verification_required === "background");
  const changedAfterVerification = (store.verifications ?? []).filter((item) => item.status_changed);

  const attentionCards = (Object.keys(MONITORED_STATUS_LABELS) as Array<Exclude<NotificationStatusKey, "RENEWAL_OVERDUE">>).map((key) => {
    const records = evaluated.filter((row) => row.status_key === key);
    const staffRecords = records.filter((row) => row.next_action_owner === "hefamaa");
    const facilityRecords = records.filter((row) => row.next_action_owner === "facility");
    const activityDates = records.map((row) => parseDateValue(row.last_activity_date)).filter((date): date is Date => Boolean(date));
    const oldest = latestDate(activityDates.map((date) => new Date(-date.getTime())));
    return {
      count: records.length,
      facilityReminderCount: facilityRecords.length,
      key,
      label: MONITORED_STATUS_LABELS[key],
      lastActivityDate: compactDate(latestDate(activityDates)),
      oldestPendingDate: oldest ? compactDate(new Date(-oldest.getTime())) : null,
      staffActionCount: staffRecords.length,
      viewHref: "/notifications/compose?status=" + encodeURIComponent(key),
    };
  });

  const result = {
    attentionCards,
    backgroundVerificationCount: backgroundVerification.length,
    backgroundVerificationQueue: backgroundVerification.slice(0, limit).map(publicIntelligenceRow),
    changedAfterVerification: changedAfterVerification.slice(0, limit),
    changedAfterVerificationCount: changedAfterVerification.length,
    delivery: deliveryStatsForRecipients(uniqueRecipients(reminderQueue.map(recipientFromEvaluation)), ["email", "sms"]),
    evaluatedCount: evaluated.length,
    hefamaaAttention: hefamaaAttention.slice(0, limit).map(publicIntelligenceRow),
    hefamaaAttentionCount: hefamaaAttention.length,
    reminderQueue: reminderQueue.slice(0, limit).map(publicIntelligenceRow),
    reminderQueueCount: reminderQueue.length,
    renewalOverdue: evaluated.filter((row) => row.status_key === "RENEWAL_OVERDUE").slice(0, limit).map(publicIntelligenceRow),
    renewalOverdueCount: evaluated.filter((row) => row.status_key === "RENEWAL_OVERDUE").length,
    staleCache: staleCache.slice(0, limit).map(publicIntelligenceRow),
    staleCacheBlockedCount: staleCache.filter((row) => row.next_action_owner === "facility" && row.reminder_due).length,
    staleCacheCount: staleCache.length,
    generatedAt: new Date().toISOString(),
  };
  notificationIntelligenceCache = { createdAt: Date.now(), limit, value: result };
  return result;
}

function targetReason(row: PortalCacheRow, type: NotificationType) {
  if (type === "expired_accreditation") return row.accreditation_status || row.registration_status || "Accreditation follow-up required";
  if (type === "inspection_reminder") return row.inspection_status || row.registration_status || "Inspection action required";
  if (type === "incomplete_record") return "Missing contact or incomplete facility record";
  if (type === "missing_documents") return row.registration_status || "Missing or queried document";
  if (type === "pending_requirements") return row.registration_status || row.requirements_status || "Pending portal requirement";
  if (type === "provisional_license_ready") return row.registration_status || "Provisional license ready for download";
  return row.registration_status || "General HEFAMAA notice";
}

function rowNeedsNotification(row: PortalCacheRow, type: NotificationType) {
  const text = [row.registration_status, row.requirements_status, row.inspection_status, row.accreditation_status, row.raw_portal_text].join(" ");
  if (type === "pending_requirements") return /quer|pending|payment approved|upload payment/i.test(text);
  if (type === "missing_documents") return /document.*quer|missing document|queried/i.test(text);
  if (type === "expired_accreditation") return /expired/i.test(text);
  if (type === "inspection_reminder") return /inspection|final approval pending/i.test(text);
  if (type === "incomplete_record") return !row.email || !row.contact || !row.address || !row.lga;
  if (type === "provisional_license_ready") return /registration approved|approved|license|licence|provisional/i.test(text);
  return true;
}

function matchesFilter(row: PortalCacheRow, input: NotificationPreviewRequest) {
  const query = normalize(input.facilityQuery);
  const haystack = normalize([row.facility_name, row.hef_no, row.category, row.lga, row.contact, row.email, row.registration_status].join(" "));
  if (query && !haystack.includes(query)) return false;
  if (input.category && normalize(row.category) !== normalize(input.category)) return false;
  if (input.lga && !normalize(row.lga).includes(normalize(input.lga))) return false;
  if (input.status && !normalize(row.registration_status).includes(normalize(input.status))) return false;
  return rowNeedsNotification(row, input.notificationType);
}

function recipientFromRow(row: PortalCacheRow, input: NotificationPreviewRequest): NotificationRecipient {
  const reason = targetReason(row, input.notificationType);
  const store = readStore();
  const evaluated = evaluateNotificationRow(row, store);
  return {
    attention_type: evaluated?.status_key,
    cache_age_days: evaluated?.cache_age_days,
    cache_policy: evaluated?.cache_policy,
    category: clean(row.category),
    contact_email: clean(row.email),
    contact_phone: clean(row.contact),
    days_pending: evaluated?.days_pending,
    facility_name: clean(row.facility_name),
    hef_no: clean(row.hef_no),
    id: row.id,
    last_activity_date: evaluated?.last_activity_date,
    last_reminder_at: evaluated?.last_reminder_at,
    lga: clean(row.lga),
    missing_requirements: input.customMessage || evaluated?.reason || reason,
    next_action_owner: evaluated?.next_action_owner,
    next_reminder_at: evaluated?.next_reminder_at,
    owner_name: clean(row.owner_name) || clean(row.facility_name) || "Facility Owner",
    portal_status: clean(row.registration_status),
    reason: evaluated?.reason || reason,
    reminder_block_reason: evaluated?.reminder_block_reason,
    reminder_due: evaluated?.reminder_due,
    reminder_policy: evaluated?.reminder_policy,
    source_url: clean(row.source_url),
    verification_reason: evaluated?.verification_reason,
    verification_required: evaluated?.verification_required,
  };
}

function uniqueRecipients(recipients: NotificationRecipient[]) {
  const seen = new Set<string>();
  const unique: NotificationRecipient[] = [];
  for (const recipient of recipients) {
    const key = [recipient.facility_name, recipient.hef_no, recipient.contact_email, recipient.contact_phone].map(normalize).join("|");
    if (!recipient.facility_name || seen.has(key)) continue;
    seen.add(key);
    unique.push(recipient);
  }
  return unique;
}

function templateIdFor(type: NotificationType, channel: NotificationChannel, preferred?: string) {
  if (preferred) return preferred;
  if (type === "pending_requirements") return channel === "email" ? "pending_requirements_email" : "pending_requirements_sms";
  if (type === "expired_accreditation") return channel === "email" ? "expired_accreditation_email" : "expired_accreditation_sms";
  if (type === "missing_documents") return channel === "email" ? "missing_documents_email" : "missing_documents_sms";
  if (type === "inspection_reminder") return channel === "email" ? "inspection_reminder_email" : "inspection_reminder_sms";
  if (type === "provisional_license_ready") return channel === "email" ? "provisional_license_ready_email" : "provisional_license_ready_sms";
  return channel === "email" ? "general_notice_email" : "general_notice_sms";
}

function automatedReminderMessage(recipient: NotificationRecipient, input: NotificationPreviewRequest, channel: NotificationChannel) {
  if (input.notificationType !== "pending_requirements" || input.customMessage || input.customSubject) return null;

  const portal = input.portalLink || process.env.HEFAMAA_PORTAL_URL || "https://portal.hefamaaportal.com.ng/";
  const facility = recipient.facility_name || "your facility";
  const hefNo = recipient.hef_no || "Not available";
  const reason = recipient.portal_status || recipient.reason || "Pending portal action";
  const details = recipient.reason || recipient.missing_requirements || reason;

  if (recipient.attention_type === "DOCUMENT_QUERIED") {
    if (channel === "sms") {
      return {
        message: [
          "HEFAMAA Reminder:",
          "",
          facility + " has an unresolved query.",
          "",
          "Reason:",
          reason,
          "",
          "Please log in to the portal and resolve the issue.",
          "",
          "HEFAI",
        ].join("\n"),
        subject: "",
        templateId: "pending_requirements_sms",
      };
    }
    return {
      message: [
        "Dear " + facility + ",",
        "",
        "This is a reminder regarding an unresolved query on your HEFAMAA portal profile.",
        "",
        "Facility:",
        facility,
        "",
        "HEF Number:",
        hefNo,
        "",
        "Query Reason:",
        reason,
        "",
        "Additional Details:",
        details,
        "",
        "Our records indicate that the query remains unresolved.",
        "",
        "Please log in to the HEFAMAA portal and address the issue as soon as possible to avoid delays in your approval or renewal process.",
        "",
        "Portal:",
        portal,
        "",
        "If you have already resolved this issue, please disregard this message.",
        "",
        "Regards,",
        "",
        "HEFAI",
        "HEFAMAA Intelligent Assistant",
      ].join("\n"),
      subject: "HEFAMAA Compliance Query Reminder",
      templateId: "pending_requirements_email",
    };
  }

  if (recipient.attention_type === "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING") {
    if (channel === "sms") return { message: "HEFAMAA Reminder: " + facility + " uploaded payment documents but the renewal process remains incomplete. Please review your portal: " + portal, subject: "", templateId: "pending_requirements_sms" };
    return {
      message: [
        "Dear " + facility + ",",
        "",
        "Our records indicate that your facility uploaded payment documents but the renewal process remains incomplete.",
        "",
        "Please review your portal profile and ensure all required steps have been completed.",
        "",
        "Portal:",
        portal,
        "",
        "Regards,",
        "",
        "HEFAI",
        "HEFAMAA Intelligent Assistant",
      ].join("\n"),
      subject: "HEFAMAA Renewal Process Reminder",
      templateId: "pending_requirements_email",
    };
  }

  if (recipient.attention_type === "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING") {
    if (channel === "sms") return { message: "HEFAMAA Reminder: Payment for " + facility + " has been confirmed, but renewal remains incomplete. Please review your portal: " + portal, subject: "", templateId: "pending_requirements_sms" };
    return {
      message: [
        "Dear " + facility + ",",
        "",
        "Your payment has been successfully confirmed.",
        "",
        "However, your renewal process remains incomplete.",
        "",
        "Please review your facility portal and ensure all outstanding requirements have been fulfilled.",
        "",
        "Portal:",
        portal,
        "",
        "Regards,",
        "",
        "HEFAI",
        "HEFAMAA Intelligent Assistant",
      ].join("\n"),
      subject: "HEFAMAA Document Approval Reminder",
      templateId: "pending_requirements_email",
    };
  }

  if (recipient.attention_type === "FINAL_APPROVAL_PENDING") {
    if (channel === "sms") return { message: "HEFAMAA Reminder: " + facility + " has reached final approval stage but remains incomplete. Please review your portal: " + portal, subject: "", templateId: "pending_requirements_sms" };
    return {
      message: [
        "Dear " + facility + ",",
        "",
        "Your facility renewal process has reached the final approval stage.",
        "",
        "However, the process remains incomplete.",
        "",
        "Please review your facility profile and ensure there are no outstanding actions required from your end.",
        "",
        "Portal:",
        portal,
        "",
        "Regards,",
        "",
        "HEFAI",
        "HEFAMAA Intelligent Assistant",
      ].join("\n"),
      subject: "HEFAMAA Final Approval Reminder",
      templateId: "pending_requirements_email",
    };
  }

  if (recipient.attention_type === "RENEWAL_OVERDUE") {
    if (channel === "sms") return { message: "HEFAMAA Reminder: " + facility + " has not completed annual renewal for the current year. Please log in and complete renewal: " + portal, subject: "", templateId: "pending_requirements_sms" };
    return {
      message: [
        "Dear " + facility + ",",
        "",
        "Our records indicate that your facility has not completed its annual renewal process for the current year.",
        "",
        "HEFAMAA annual renewal runs from January 1 to March 31.",
        "",
        "Failure to complete renewal within the approved timeline may attract additional penalties and delays.",
        "",
        "Please log in to the portal and complete your renewal process.",
        "",
        "Portal:",
        portal,
        "",
        "Regards,",
        "",
        "HEFAI",
        "HEFAMAA Intelligent Assistant",
      ].join("\n"),
      subject: "HEFAMAA Annual Renewal Reminder",
      templateId: "pending_requirements_email",
    };
  }

  return null;
}

function renderMessage(recipient: NotificationRecipient, input: NotificationPreviewRequest, channel: NotificationChannel) {
  const automated = automatedReminderMessage(recipient, input, channel);
  if (automated) return automated;

  const template = templateFor(channel, templateIdFor(input.notificationType, channel, input.templateId) as NotificationTemplateId);
  const rendered = renderTemplate(template, {
    agencyName: "HEFAMAA",
    category: recipient.category,
    deadline: input.deadline || "7 days",
    facilityName: recipient.facility_name,
    lga: recipient.lga,
    missingRequirements: input.customMessage || recipient.missing_requirements || recipient.reason,
    ownerName: recipient.owner_name,
    portalLink: input.portalLink || process.env.HEFAMAA_PORTAL_URL || "https://portal.hefamaaportal.com.ng/",
  });

  return {
    message: input.customMessage || rendered.message,
    subject: input.customSubject || rendered.subject,
    templateId: template.id,
  };
}

function recentDuplicate(recipient: NotificationRecipient, type: NotificationType, channel: NotificationChannel) {
  const duplicateWindowStart = Date.now() - 60 * 60 * 1000;
  return readStore().logs.find((log) => {
    const date = Date.parse(log.sent_at || log.created_at);
    return date >= duplicateWindowStart
      && normalize(log.facility_name) === normalize(recipient.facility_name)
      && log.notification_type === type
      && log.channel === channel
      && ["sent", "pending"].includes(log.status);
  });
}

function notificationIntelligenceRecipients(input: NotificationPreviewRequest) {
  const store = readStore();
  const rows = evaluatedNotificationRows(store)
    .filter((row) => row.next_action_owner === "facility" && (input.includeNotDue || row.reminder_due))
    .filter((row) => matchesIntelligenceFilter(row, input));
  return uniqueRecipients(rows.map(recipientFromEvaluation)).slice(0, input.limit);
}

export async function sourceMissingNotificationContacts(rawInput: unknown = {}) {
  const input = contactSourcingRequestSchema.parse(rawInput ?? {});
  const store = readStore();
  let rows = evaluatedNotificationRows(store);

  if (input.owner !== "all") rows = rows.filter((row) => row.next_action_owner === input.owner);
  if (input.dueOnly) rows = rows.filter((row) => row.next_action_owner === "facility" && row.reminder_due);

  rows = rows.filter((row) => matchesIntelligenceFilter(row, {
    category: input.category || "",
    channels: ["email"],
    customMessage: "",
    customSubject: "",
    deadline: "",
    facilityQuery: input.facilityQuery || "",
    forceSend: false,
    includeNotDue: true,
    lga: "",
    limit: input.limit,
    notificationType: "pending_requirements",
    portalLink: "",
    selectedRecipientIds: undefined,
    status: input.status || "",
    templateId: "",
  }));

  const targets = rows.slice(0, input.limit).map((row) => ({
    category: row.category,
    facilityName: row.facility_name,
    hefNo: row.hef_no,
    id: row.id,
    lga: row.lga,
    missingEmail: !row.contact_email,
    missingPhone: !row.contact_phone,
    portalStatus: row.portal_status,
  })).filter((target) => target.missingEmail || target.missingPhone);

  const result = await sourceMissingPortalContacts(targets, { includeSheets: input.includeSheets });
  invalidateNotificationCaches();
  return result;
}

export function listNotificationStatusFacilities(rawInput: unknown) {
  const input = notificationFacilityListRequestSchema.parse(rawInput);
  const store = readStore();
  let rows = evaluatedNotificationRows(store);

  if (input.owner !== "all") {
    rows = rows.filter((row) => row.next_action_owner === input.owner);
  }

  if (input.dueOnly) {
    rows = rows.filter((row) => row.next_action_owner === "facility" && row.reminder_due);
  }

  rows = rows.filter((row) => matchesIntelligenceFilter(row, {
    category: input.category || "",
    channels: ["email"],
    customMessage: "",
    customSubject: "",
    deadline: "",
    facilityQuery: input.facilityQuery || "",
    forceSend: false,
    includeNotDue: true,
    lga: input.lga || "",
    limit: input.limit,
    notificationType: "pending_requirements",
    portalLink: "",
    selectedRecipientIds: undefined,
    status: input.status || "",
    templateId: "",
  }));

  const reminderRows = rows.filter((row) => row.next_action_owner === "facility");

  return {
    count: rows.length,
    delivery: deliveryStatsForRecipients(uniqueRecipients(reminderRows.map(recipientFromEvaluation)), ["email", "sms"]),
    owner: input.owner,
    rows: rows.slice(0, input.limit).map(publicIntelligenceRow),
    status: input.status || "",
  };
}

export function findNotificationRecipients(rawInput: unknown) {
  const input = notificationPreviewRequestSchema.parse(rawInput);
  if (input.notificationType === "pending_requirements") {
    const intelligent = notificationIntelligenceRecipients(input);
    if (input.selectedRecipientIds?.length) {
      const selected = new Set(input.selectedRecipientIds);
      return intelligent.filter((recipient) => selected.has(recipient.id));
    }
    return intelligent;
  }

  const rows = readPortalCacheRows().filter((row) => matchesFilter(row, input));
  const recipients = uniqueRecipients(rows.map((row) => recipientFromRow(row, input))).slice(0, input.limit);
  if (!input.selectedRecipientIds?.length) return recipients;
  const selected = new Set(input.selectedRecipientIds);
  return recipients.filter((recipient) => selected.has(recipient.id));
}

export function previewNotifications(rawInput: unknown) {
  const input = notificationPreviewRequestSchema.parse(rawInput);
  const recipients = findNotificationRecipients(input);
  const delivery = deliveryStatsForRecipients(recipients, input.channels);
  const messages = recipients.flatMap((recipient) => input.channels.map((channel) => {
    const duplicate = recentDuplicate(recipient, input.notificationType, channel);
    const rendered = renderMessage(recipient, input, channel);
    const staleBlocked = recipient.next_action_owner === "facility" && recipient.verification_required === "before_send";
    return {
      blockedByDuplicate: Boolean(duplicate && !input.forceSend),
      blockedByStaleCache: staleBlocked,
      channel,
      destination: channel === "email" ? recipient.contact_email : recipient.contact_phone,
      duplicateLogId: duplicate?.id ?? null,
      message: rendered.message,
      recipient,
      subject: rendered.subject,
      templateId: rendered.templateId,
      verificationNotice: staleBlocked ? recipient.verification_reason : null,
    };
  }));

  return {
    duplicateBlocked: messages.filter((message) => message.blockedByDuplicate).length,
    delivery,
    intelligence: buildNotificationIntelligence({ limit: input.limit }),
    messages,
    recipientCount: recipients.length,
    recipients,
    requiresConfirmation: true,
    staleCacheBlocked: messages.filter((message) => message.blockedByStaleCache).length,
  };
}

function skippedLog(recipient: NotificationRecipient, input: NotificationSendRequest, channel: NotificationChannel, rendered: { message: string; subject: string }, providerResponse: string, verificationStatus?: string): NotificationLog {
  const createdAt = new Date().toISOString();
  return {
    category: recipient.category,
    channel,
    contact_email: recipient.contact_email,
    contact_phone: recipient.contact_phone,
    created_at: createdAt,
    created_by: input.createdBy,
    facility_name: recipient.facility_name,
    hef_no: recipient.hef_no,
    id: "notif-" + Date.now().toString(36) + "-skip-" + Math.random().toString(36).slice(2, 7),
    lga: recipient.lga,
    message: rendered.message,
    notification_type: input.notificationType,
    provider_response: providerResponse,
    sent_at: null,
    status: "skipped",
    subject: rendered.subject,
    verification_status: verificationStatus,
  };
}

function statusFromText(text: string) {
  const normalized = normalize(text);
  if (/document(s)? queried|document query|queried/.test(normalized)) return "DOCUMENTS QUERIED";
  if (/payment approved.*pending document/.test(normalized)) return "PAYMENT APPROVED AND PENDING DOCUMENT APPROVAL";
  if (/upload payment.*pending document|upload payment/.test(normalized)) return "UPLOAD PAYMENT AND PENDING DOCUMENT APPROVAL";
  if (/final approval pending/.test(normalized)) return "FINAL APPROVAL PENDING";
  return "";
}

async function verifyRecipientBeforeSend(recipient: NotificationRecipient) {
  if (recipient.verification_required !== "before_send") {
    return { note: recipient.verification_required === "background" ? "Cache used now; queued for background verification." : "Fresh cache used.", recipient, status: "not_required" as const };
  }

  try {
    const portal = await import("@/lib/playwrightPortal");
    await portal.searchFacility({ facilityName: recipient.facility_name });
    const capture = await portal.captureCurrentPageText();
    const liveText = clean(capture.bodyText || capture.text);
    const liveStatus = clean(capture.selectedPortalRecord?.registrationStatus || capture.renewalStatus || statusFromText(liveText) || recipient.portal_status);
    const liveRow: PortalCacheRow = {
      accreditation_status: null,
      address: null,
      captured_at: new Date().toISOString(),
      category: recipient.category || capture.selectedPortalRecord?.category || null,
      sector: null,
      contact: recipient.contact_phone || null,
      admissionBeds: null,
      observationBeds: null,
      couches: null,
      bedDistribution: { admissionBeds: null, observationBeds: null, couches: null },
      doctors_count: null,
      email: recipient.contact_email || null,
      facility_name: recipient.facility_name,
      hef_no: recipient.hef_no || capture.selectedPortalRecord?.hefamaaId || null,
      id: recipient.id,
      inspection_status: null,
      lga: recipient.lga || null,
      lcda: null,
      nurses_count: null,
      owner_name: recipient.owner_name || null,
      raw_portal_text: liveText,
      registration_status: liveStatus || null,
      requirements_status: null,
      source_url: typeof portal.getCurrentPortalUrl === "function" ? await portal.getCurrentPortalUrl().catch(() => "") : "",
      structured_portal_data: { selectedPortalRecord: capture.selectedPortalRecord ?? null, selectedRenewalYear: capture.selectedRenewalYear ?? null },
      updated_at: new Date().toISOString(),
    };
    const store = readStore();
    const evaluated = evaluateNotificationRow(liveRow, store);
    const statusChanged = normalize(liveStatus) !== normalize(recipient.portal_status);
    const verification: VerificationRecord = {
      checked_at: new Date().toISOString(),
      facility_name: recipient.facility_name,
      new_status: liveStatus,
      old_status: recipient.portal_status,
      reason: evaluated?.reason || "Live portal verification completed.",
      result: evaluated?.next_action_owner === "facility" && evaluated.reminder_due ? "confirmed_facility_action" : evaluated?.next_action_owner === "hefamaa" ? "hefamaa_action" : "no_action",
      status_changed: statusChanged,
    };
    store.verifications = [verification, ...(store.verifications ?? [])].slice(0, 500);
    writeStore(store);

    if (!evaluated || evaluated.next_action_owner !== "facility" || !evaluated.reminder_due) {
      return {
        note: "Live portal verification shows this facility should not receive a reminder now. " + (evaluated?.reason || "No facility action is currently required."),
        recipient: { ...recipient, portal_status: liveStatus, verification_required: "none" as VerificationRequirement },
        status: "skip" as const,
      };
    }

    return {
      note: "Live portal verification confirmed the facility is still responsible for the next action.",
      recipient: recipientFromEvaluation(evaluated),
      status: "confirmed" as const,
    };
  } catch (error) {
    return {
      note: "Skipped because cache is older than 7 days and live portal verification could not be completed: " + (error instanceof Error ? error.message : "Unknown portal verification error"),
      recipient,
      status: "failed" as const,
    };
  }
}

async function sendOne(recipient: NotificationRecipient, input: NotificationSendRequest, channel: NotificationChannel): Promise<NotificationLog> {
  const rendered = renderMessage(recipient, input, channel);
  const duplicate = recentDuplicate(recipient, input.notificationType, channel);

  if (duplicate && !input.forceSend) {
    return skippedLog(recipient, input, channel, rendered, "Skipped because the same reminder was already sent or queued within the last hour.", "duplicate_recent_hour");
  }

  const verification = await verifyRecipientBeforeSend(recipient);
  if (verification.status === "skip" || verification.status === "failed") {
    return skippedLog(verification.recipient, input, channel, rendered, verification.note, verification.status === "failed" ? "live_verification_failed" : "live_verification_changed_action");
  }

  const verifiedRecipient = verification.recipient;
  const verifiedRendered = verifiedRecipient === recipient ? rendered : renderMessage(verifiedRecipient, input, channel);
  const destination = channel === "email" ? verifiedRecipient.contact_email : verifiedRecipient.contact_phone;
  if (!destination) {
    return skippedLog(verifiedRecipient, input, channel, verifiedRendered, "Skipped because no " + channel + " destination is available for this facility.", verification.status);
  }

  const providerResult = channel === "email"
    ? await sendEmailNotification({ facilityName: verifiedRecipient.facility_name, html: verifiedRendered.message, notificationType: input.notificationType, subject: verifiedRendered.subject, to: destination })
    : await sendSmsNotification({ facilityName: verifiedRecipient.facility_name, message: verifiedRendered.message, notificationType: input.notificationType, to: destination });

  const createdAt = new Date().toISOString();
  return {
    category: verifiedRecipient.category,
    channel,
    contact_email: verifiedRecipient.contact_email,
    contact_phone: verifiedRecipient.contact_phone,
    created_at: createdAt,
    created_by: input.createdBy,
    facility_name: verifiedRecipient.facility_name,
    hef_no: verifiedRecipient.hef_no,
    id: "notif-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
    lga: verifiedRecipient.lga,
    message: verifiedRendered.message,
    notification_type: input.notificationType,
    provider_response: "[StatusKey:" + (verifiedRecipient.attention_type || "unknown") + "] " + providerResult.provider + ": " + providerResult.providerResponse + " | " + verification.note,
    sent_at: providerResult.status === "sent" ? new Date().toISOString() : null,
    status: providerResult.status,
    subject: verifiedRendered.subject,
    verification_status: verification.status,
  };
}

export async function sendNotifications(rawInput: unknown) {
  const input = notificationSendRequestSchema.parse(rawInput);
  const preview = previewNotifications(input);
  if (!input.confirmed) return { ...preview, logs: [], requiresConfirmation: true };

  const logs: NotificationLog[] = [];
  for (let index = 0; index < preview.recipients.length; index += 20) {
    const batch = preview.recipients.slice(index, index + 20);
    for (const recipient of batch) {
      for (const channel of input.channels) {
        const log = await sendOne(recipient, input, channel);
        if (log.status === "failed") {
          const retry = await sendOne(recipient, { ...input, forceSend: true }, channel);
          logs.push(retry.status === "sent" ? retry : log);
        } else {
          logs.push(log);
        }
      }
    }
  }

  const store = readStore();
  store.logs.unshift(...logs);
  writeStore(store);
  invalidateNotificationCaches();
  return { ...preview, logs, requiresConfirmation: false, summary: getNotificationDashboard() };
}

export async function runDailyNotificationScan(rawInput: unknown = {}) {
  const input = dailyScanRequestSchema.parse(rawInput);
  const sendInput: NotificationSendRequest = {
    category: input.category || "",
    channels: input.channels,
    confirmed: input.confirmed,
    createdBy: input.createdBy,
    customMessage: input.customMessage || "",
    customSubject: input.customSubject || "",
    deadline: input.deadline || "7 days",
    facilityQuery: input.facilityQuery || "",
    forceSend: input.forceSend ?? false,
    includeNotDue: input.includeNotDue ?? false,
    lga: input.lga || "",
    limit: input.limit,
    notificationType: "pending_requirements",
    portalLink: input.portalLink || "",
    selectedRecipientIds: input.selectedRecipientIds,
    status: input.status || "",
    templateId: input.templateId || "",
  };
  const preview = previewNotifications(sendInput);
  if (!input.confirmed) {
    return {
      intelligence: compactNotificationIntelligence(preview.intelligence),
      delivery: preview.intelligence.delivery,
      logs: [],
      preview: compactNotificationPreview(preview),
      sent: false,
      summary: "Daily scan generated bulk reminder and HEFAMAA attention queues by status. Sending still requires confirmation.",
    };
  }
  const sent = await sendNotifications(sendInput);
  const dashboard = getNotificationDashboard();
  return {
    intelligence: compactNotificationIntelligence(dashboard.intelligence),
    delivery: sent.delivery,
    logs: sent.logs.map(compactNotificationLog),
    preview: compactNotificationPreview(preview),
    sent: true,
    summary: "Daily scan processed the confirmed bulk reminder queue for all eligible facilities by status. Stale records were verified before any send attempt.",
  };
}

export function listNotificationLogs(filters: Record<string, string | undefined> = {}) {
  const logs = readStore().logs;
  return logs.filter((log) => {
    if (filters.category && normalize(log.category) !== normalize(filters.category)) return false;
    if (filters.lga && !normalize(log.lga).includes(normalize(filters.lga))) return false;
    if (filters.channel && log.channel !== filters.channel) return false;
    if (filters.status && log.status !== filters.status) return false;
    return true;
  });
}

export function resolveFailedNotificationLogs(rawInput: unknown = {}) {
  const input = notificationFailureResolutionSchema.parse(rawInput ?? {});
  const store = readStore();
  const now = new Date().toISOString();
  const byChannel: Record<NotificationChannel, number> = { email: 0, sms: 0 };
  let resolved = 0;

  const logs = store.logs.map((log) => {
    if (log.status !== "failed") return log;
    if (input.channel !== "all" && log.channel !== input.channel) return log;

    resolved += 1;
    byChannel[log.channel] = (byChannel[log.channel] ?? 0) + 1;

    const resolutionText = "Resolved " + now + " by " + input.createdBy + ": " + input.note;
    const providerResponse = clean(log.provider_response);

    return {
      ...log,
      original_status: log.original_status ?? "failed",
      provider_response: providerResponse ? providerResponse + " | " + resolutionText : resolutionText,
      resolution_note: input.note,
      resolved_at: now,
      resolved_by: input.createdBy,
      status: "resolved" as const,
    };
  });

  writeStore({ ...store, logs });

  const statusCounts = logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.status] = (acc[log.status] ?? 0) + 1;
    return acc;
  }, {});

  return { byChannel, channel: input.channel, resolved, resolvedAt: now, statusCounts };
}

export function getNotificationDashboard(options: { compact?: boolean } = {}) {
  const compact = Boolean(options.compact);
  const ttlMs = notificationCacheTtlMs();

  if (notificationDashboardCache && notificationDashboardCache.compact === compact && Date.now() - notificationDashboardCache.createdAt <= ttlMs) {
    return notificationDashboardCache.value;
  }

  const deps = compact ? compactDashboardDeps() : null;
  const cachedDashboard = deps ? readCompactDashboardCache(deps) : null;
  if (cachedDashboard) {
    notificationDashboardCache = { compact, createdAt: Date.now(), value: cachedDashboard };
    return cachedDashboard;
  }

  const logs = readStore().logs;
  const countByStatus = logs.reduce<Record<string, number>>((acc, log) => {
    acc[log.status] = (acc[log.status] ?? 0) + 1;
    return acc;
  }, {});
  const channelStatusCounts = logs.reduce<Record<string, Record<string, number>>>((acc, log) => {
    acc[log.channel] = acc[log.channel] ?? {};
    acc[log.channel][log.status] = (acc[log.channel][log.status] ?? 0) + 1;
    return acc;
  }, {});
  const intelligence = buildNotificationIntelligence({ limit: compact ? 5 : 100 });
  const refreshPlan = compact ? null : buildPortalCacheFreshnessPlan(8);

  const dashboard = {
    availableProviders: {
      activeEmailProvider: process.env.EMAIL_PROVIDER?.trim() || "auto",
      emailWebhook: Boolean(process.env.EMAIL_NOTIFICATION_WEBHOOK_URL),
      gmailSmtp: Boolean(process.env.GMAIL_SMTP_USER && process.env.GMAIL_SMTP_APP_PASSWORD),
      resend: Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL),
      smsWebhook: Boolean(process.env.SMS_NOTIFICATION_WEBHOOK_URL),
      termii: Boolean(process.env.TERMII_API_KEY),
    },
    cacheFreshness: refreshPlan,
    channelStatusCounts,
    facilitiesRequiringAttention: intelligence.reminderQueueCount + intelligence.hefamaaAttentionCount,
    intelligence: compact ? compactNotificationIntelligence(intelligence) : intelligence,
    notificationRules: listNotificationRules(),
    outboxCount: logs.length,
    recentMessages: logs.slice(0, 12).map(compactNotificationLog),
    reminderCandidates: intelligence.reminderQueueCount,
    scheduler: schedulerSummary(),
    statusCounts: countByStatus,
    totalFailed: countByStatus.failed ?? 0,
    totalPending: countByStatus.pending ?? 0,
    totalResolved: countByStatus.resolved ?? 0,
    totalSent: countByStatus.sent ?? 0,
    totalSkipped: countByStatus.skipped ?? 0,
  };

  notificationDashboardCache = { compact, createdAt: Date.now(), value: dashboard };
  if (deps) writeCompactDashboardCache(deps, dashboard);
  return dashboard;
}

export function listNotificationTemplates() {
  return DEFAULT_NOTIFICATION_TEMPLATES;
}

export function upsertNotificationRule(rawRule: unknown) {
  return saveNotificationRule(rawRule);
}
