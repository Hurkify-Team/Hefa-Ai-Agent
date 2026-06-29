import { readFile, stat } from "node:fs/promises";

import { fail, ok } from "@/lib/apiResponse";
import { configuredRuntimeFile } from "@/lib/runtimeData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type NotificationStatusKey =
  | "DOCUMENT_QUERIED"
  | "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING"
  | "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING"
  | "FINAL_APPROVAL_PENDING"
  | "RENEWAL_OVERDUE";

type CachePolicy = "fresh" | "background_verification" | "live_verification_required";
type VerificationRequirement = "none" | "background" | "before_send";
type NextActionOwner = "facility" | "hefamaa";

type NotificationLog = {
  channel?: string;
  created_at?: string;
  facility_name?: string;
  id?: string;
  notification_type?: string;
  sent_at?: string | null;
  status?: string;
  subject?: string;
};

type PortalLikeRow = Record<string, unknown> & {
  category?: string;
  contact?: string;
  email?: string;
  facilityName?: string;
  facility_name?: string;
  hef_no?: string;
  hefamaaId?: string;
  id?: string;
  index?: number;
  lastSeen?: string;
  lga?: string;
  normalizedStatus?: string;
  recordDate?: string | null;
  registrationStatus?: string;
  registration_status?: string;
  renewalYear?: number | string | null;
  text?: string;
  visibleFields?: Record<string, unknown>;
};

type QaLikeRecord = Record<string, unknown> & {
  category?: string;
  facilityName?: string;
  hefamaaId?: string;
  qaFields?: Record<string, unknown>;
  recordDate?: string | null;
  registrationStatus?: string;
  renewalYear?: number | string | null;
  sourceRecord?: Record<string, unknown>;
};

type EvaluatedRow = {
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

const DATA_FILES = {
  logs: "notification-logs.json",
  portalCache: "portal-facilities-cache.json",
  qaIndex: "portal-qa-index.json",
  rules: "notification-rules.json",
} as const;

const DATA_FILE_ENVS: Record<keyof typeof DATA_FILES, string> = {
  logs: "NOTIFICATION_LOGS_PATH",
  portalCache: "HEFAMAA_PORTAL_CACHE",
  qaIndex: "HEFAMAA_PORTAL_QA_INDEX",
  rules: "NOTIFICATION_RULES_PATH",
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

function dataFile(name: keyof typeof DATA_FILES) {
  return configuredRuntimeFile(DATA_FILE_ENVS[name], DATA_FILES[name]);
}

async function safeJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function safeMtime(file: string) {
  try {
    return (await stat(file)).mtimeMs;
  } catch {
    return 0;
  }
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function parseDateValue(value: unknown) {
  const text = clean(value);
  if (!text) return null;
  const direct = new Date(text);
  return Number.isFinite(direct.getTime()) ? direct : null;
}

function compactDate(value: Date | null) {
  return value && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function daysBetween(older: Date | null, newer = new Date()) {
  if (!older || !Number.isFinite(older.getTime())) return null;
  return Math.max(0, (newer.getTime() - older.getTime()) / 86400000);
}

function statusKeyFor(status: string): Exclude<NotificationStatusKey, "RENEWAL_OVERDUE"> | null {
  const text = normalize(status);
  if (/document(s)? queried|document query|queried/.test(text)) return "DOCUMENT_QUERIED";
  if (/upload payment.*pending document|payment upload.*pending document|upload payment/.test(text)) return "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING";
  if (/payment approved.*pending document|payment confirmed.*pending document/.test(text)) return "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING";
  if (/final approval pending/.test(text)) return "FINAL_APPROVAL_PENDING";
  return null;
}

function cachePolicyFor(ageDays: number | null): { policy: CachePolicy; requirement: VerificationRequirement; reason: string } {
  if (ageDays === null) return { policy: "live_verification_required", requirement: "before_send", reason: "No reliable cache timestamp exists, so the live portal must verify status before sending." };
  if (ageDays <= 3) return { policy: "fresh", requirement: "none", reason: "Cache is 3 days old or newer." };
  if (ageDays <= 7) return { policy: "background_verification", requirement: "background", reason: "Cache is older than 3 days, so a background portal verification should refresh it." };
  return { policy: "live_verification_required", requirement: "before_send", reason: "Cache is older than 7 days; the portal must verify status before any reminder is sent." };
}

function latestReminderAt(logs: NotificationLog[], facilityName: string) {
  const facility = normalize(facilityName);
  const dates = logs
    .filter((log) => log.notification_type === "pending_requirements" && ["sent", "pending"].includes(clean(log.status)) && normalize(log.facility_name) === facility)
    .map((log) => parseDateValue(log.sent_at || log.created_at))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => b.getTime() - a.getTime());
  return dates[0] ?? null;
}

function renewalYearFor(row: PortalLikeRow, qa?: QaLikeRecord) {
  for (const candidate of [row.renewalYear, qa?.renewalYear, row.visibleFields?.RenewalYear, row.visibleFields?.["Renewal Year"]]) {
    const numeric = Number(candidate);
    if (Number.isInteger(numeric) && numeric >= 2015 && numeric <= new Date().getFullYear() + 1) return numeric;
  }
  return null;
}

function qaKey(name: string, category: string, hefNo: string) {
  return [normalize(name), normalize(category), normalize(hefNo)].join("|");
}

function buildQaMap(records: QaLikeRecord[]) {
  const map = new Map<string, QaLikeRecord>();
  for (const record of records) {
    const source = record.sourceRecord ?? {};
    const name = clean(record.facilityName || source.facilityName || source.facility_name);
    const category = clean(record.category || source.category);
    const hefNo = clean(record.hefamaaId || source.hefamaaId || source.hef_no);
    if (name) map.set(qaKey(name, category, hefNo), record);
  }
  return map;
}

function publicRow(item: EvaluatedRow) {
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

function evaluateRow(row: PortalLikeRow, qaMap: Map<string, QaLikeRecord>, logs: NotificationLog[], now = new Date()): EvaluatedRow | null {
  const facilityName = clean(row.facilityName || row.facility_name || row.visibleFields?.["FACILITY NAME"]);
  if (!facilityName) return null;

  const category = clean(row.category || row.visibleFields?.Category);
  const hefNo = clean(row.hefamaaId || row.hef_no || row.visibleFields?.["HEF/NO"] || row.visibleFields?.["HEF NO"]);
  const qa = qaMap.get(qaKey(facilityName, category, hefNo)) ?? qaMap.get(qaKey(facilityName, category, ""));
  const fields = qa?.qaFields ?? {};
  const status = clean(row.registrationStatus || row.registration_status || qa?.registrationStatus || row.normalizedStatus || row.visibleFields?.["REG. STATUS"]);
  const directStatusKey = statusKeyFor(status);
  const activityDate = parseDateValue(row.recordDate || qa?.recordDate || row.visibleFields?.["Last Activity Date"]);
  const activityYear = activityDate?.getFullYear() ?? renewalYearFor(row, qa);
  const currentYear = now.getFullYear();
  const renewalWindowEnded = now.getTime() > new Date(currentYear, 2, 31, 23, 59, 59, 999).getTime();
  const renewalOverdue = !directStatusKey && renewalWindowEnded && activityYear !== null && activityYear < currentYear;
  const statusKey = directStatusKey ?? (renewalOverdue ? "RENEWAL_OVERDUE" : null);
  if (!statusKey) return null;

  const cacheDate = parseDateValue(row.lastSeen || row.recordDate || qa?.recordDate);
  const cacheAgeDays = daysBetween(cacheDate, now);
  const cachePolicy = cachePolicyFor(cacheAgeDays);
  const lastReminder = latestReminderAt(logs, facilityName);
  const daysSinceReminder = lastReminder ? daysBetween(lastReminder, now) : Number.POSITIVE_INFINITY;
  const reminderIntervalDays = statusKey === "DOCUMENT_QUERIED" || statusKey === "RENEWAL_OVERDUE" ? 7 : 14;
  const reminderDueByCadence = daysSinceReminder === null || daysSinceReminder >= reminderIntervalDays;

  let nextActionOwner: NextActionOwner = "facility";
  let priority: EvaluatedRow["priority"] = "normal";
  let reason = "Facility requires a HEFAMAA notification follow-up.";

  if (statusKey === "DOCUMENT_QUERIED") {
    priority = "critical";
    reason = "Facility documents were queried. The facility is responsible for correcting the query and should receive reminders until the portal status changes.";
  } else if (statusKey === "RENEWAL_OVERDUE") {
    priority = "high";
    reason = "No current-year renewal activity is visible after the renewal window. The facility should receive a renewal reminder.";
  } else if (activityYear === currentYear) {
    nextActionOwner = "hefamaa";
    priority = "high";
    reason = "The facility has current-year activity in this status. The next action belongs to HEFAMAA staff, so no facility reminder should be sent.";
  } else if (activityYear && activityYear < currentYear) {
    priority = "high";
    reason = "The facility entered this status in a previous year and appears unresolved. The facility should receive a reminder.";
  }

  const nextReminder = lastReminder && !reminderDueByCadence ? new Date(lastReminder.getTime() + reminderIntervalDays * 86400000) : null;
  const email = clean(row.email || fields.email || fields["Facility E-Mail"] || fields["Email"]);
  const phone = clean(row.contact || fields.contact_phone || fields.contact || fields["Contact"] || fields["Phone"]);

  return {
    cache_age_days: cacheAgeDays,
    cache_policy: cachePolicy.policy,
    category,
    contact_email: email,
    contact_phone: phone,
    days_pending: activityDate ? Math.floor(daysBetween(activityDate, now) ?? 0) : null,
    facility_name: facilityName,
    hef_no: hefNo,
    id: clean(row.id || qa?.cacheKey || row.index || facilityName),
    last_activity_date: compactDate(activityDate),
    last_reminder_at: compactDate(lastReminder),
    lga: clean(row.lga || fields.lga || fields.LGA || row.visibleFields?.LGA),
    next_action_owner: nextActionOwner,
    next_reminder_at: compactDate(nextReminder),
    owner_name: clean(fields.owner_name || fields["Owner Name"] || fields["Owner\u2019s Name"] || facilityName),
    portal_status: status,
    priority,
    reason,
    reminder_block_reason: nextActionOwner === "facility" && !reminderDueByCadence ? "A reminder was already sent inside the configured reminder window." : nextActionOwner === "hefamaa" ? "HEFAMAA staff owns the next action." : null,
    reminder_due: nextActionOwner === "facility" && reminderDueByCadence,
    reminder_policy: statusKey === "DOCUMENT_QUERIED" || statusKey === "RENEWAL_OVERDUE" ? "Every 7 days while facility action is pending." : "Every 14 days for unresolved previous-year workflow statuses.",
    source_url: clean(row.source_url || fields.source_url),
    status_key: statusKey,
    verification_required: cachePolicy.requirement,
    verification_reason: cachePolicy.reason,
  };
}

function deliveryStats(rows: EvaluatedRow[]) {
  const byStatus = new Map<string, { key: string; label: string; recipientCount: number; emailReadyCount: number; smsReadyCount: number; missingEmailCount: number; missingPhoneCount: number; deliverableMessageCount: number; missingDestinationCount: number }>();
  const totals = { recipientCount: rows.length, requestedChannels: ["email", "sms"], emailReadyCount: 0, smsReadyCount: 0, missingEmailCount: 0, missingPhoneCount: 0, deliverableMessageCount: 0, missingDestinationCount: 0 };

  for (const row of rows) {
    const existing = byStatus.get(row.status_key) ?? { key: row.status_key, label: row.status_key === "RENEWAL_OVERDUE" ? "Renewal Overdue" : MONITORED_STATUS_LABELS[row.status_key], recipientCount: 0, emailReadyCount: 0, smsReadyCount: 0, missingEmailCount: 0, missingPhoneCount: 0, deliverableMessageCount: 0, missingDestinationCount: 0 };
    const hasEmail = Boolean(row.contact_email);
    const hasPhone = Boolean(row.contact_phone);
    const deliverable = (hasEmail ? 1 : 0) + (hasPhone ? 1 : 0);
    const missing = (hasEmail ? 0 : 1) + (hasPhone ? 0 : 1);
    totals.emailReadyCount += hasEmail ? 1 : 0;
    totals.smsReadyCount += hasPhone ? 1 : 0;
    totals.missingEmailCount += hasEmail ? 0 : 1;
    totals.missingPhoneCount += hasPhone ? 0 : 1;
    totals.deliverableMessageCount += deliverable;
    totals.missingDestinationCount += missing;
    existing.recipientCount += 1;
    existing.emailReadyCount += hasEmail ? 1 : 0;
    existing.smsReadyCount += hasPhone ? 1 : 0;
    existing.missingEmailCount += hasEmail ? 0 : 1;
    existing.missingPhoneCount += hasPhone ? 0 : 1;
    existing.deliverableMessageCount += deliverable;
    existing.missingDestinationCount += missing;
    byStatus.set(row.status_key, existing);
  }

  return { ...totals, byStatus: Array.from(byStatus.values()).sort((a, b) => STATUS_RANK[a.key as NotificationStatusKey] - STATUS_RANK[b.key as NotificationStatusKey]) };
}

function compactLog(log: NotificationLog) {
  return {
    channel: clean(log.channel),
    created_at: clean(log.created_at),
    facility_name: clean(log.facility_name),
    id: clean(log.id),
    notification_type: clean(log.notification_type),
    sent_at: log.sent_at ?? null,
    status: clean(log.status),
    subject: clean(log.subject),
  };
}

async function buildSummary() {
  const [portalRows, qaFile, notificationStore, rulesFile, portalMtime, qaMtime, logsMtime] = await Promise.all([
    safeJson<PortalLikeRow[]>(dataFile("portalCache"), []),
    safeJson<{ records?: QaLikeRecord[] }>(dataFile("qaIndex"), { records: [] }),
    safeJson<{ logs?: NotificationLog[]; verifications?: Array<Record<string, unknown>> }>(dataFile("logs"), { logs: [], verifications: [] }),
    safeJson<{ rules?: Array<{ enabled?: boolean }> }>(dataFile("rules"), { rules: [] }),
    safeMtime(dataFile("portalCache")),
    safeMtime(dataFile("qaIndex")),
    safeMtime(dataFile("logs")),
  ]);

  const logs = Array.isArray(notificationStore.logs) ? notificationStore.logs : [];
  const qaMap = buildQaMap(Array.isArray(qaFile.records) ? qaFile.records : []);
  const evaluated = portalRows
    .map((row) => evaluateRow(row, qaMap, logs))
    .filter((row): row is EvaluatedRow => Boolean(row))
    .sort((a, b) => STATUS_RANK[a.status_key] - STATUS_RANK[b.status_key] || a.facility_name.localeCompare(b.facility_name));

  const reminderQueue = evaluated.filter((row) => row.next_action_owner === "facility" && row.reminder_due);
  const hefamaaAttention = evaluated.filter((row) => row.next_action_owner === "hefamaa");
  const staleCache = evaluated.filter((row) => row.verification_required === "before_send");
  const backgroundVerification = evaluated.filter((row) => row.verification_required === "background");
  const changedAfterVerification = (notificationStore.verifications ?? []).filter((item) => item.status_changed === true);
  const countByStatus = logs.reduce<Record<string, number>>((acc, log) => {
    const key = clean(log.status) || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const channelStatusCounts = logs.reduce<Record<string, Record<string, number>>>((acc, log) => {
    const channel = clean(log.channel) || "unknown";
    const status = clean(log.status) || "unknown";
    acc[channel] = acc[channel] ?? {};
    acc[channel][status] = (acc[channel][status] ?? 0) + 1;
    return acc;
  }, {});
  const attentionCards = (Object.keys(MONITORED_STATUS_LABELS) as Array<Exclude<NotificationStatusKey, "RENEWAL_OVERDUE">>).map((key) => {
    const records = evaluated.filter((row) => row.status_key === key);
    const staffRecords = records.filter((row) => row.next_action_owner === "hefamaa");
    const facilityRecords = records.filter((row) => row.next_action_owner === "facility");
    const activityDates = records.map((row) => parseDateValue(row.last_activity_date)).filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime());
    return {
      count: records.length,
      facilityReminderCount: facilityRecords.length,
      key,
      label: MONITORED_STATUS_LABELS[key],
      lastActivityDate: compactDate(activityDates.at(-1) ?? null),
      oldestPendingDate: compactDate(activityDates[0] ?? null),
      staffActionCount: staffRecords.length,
      viewHref: "/notifications/compose?status=" + encodeURIComponent(key),
    };
  });

  const intelligence = {
    attentionCards,
    backgroundVerificationCount: backgroundVerification.length,
    changedAfterVerificationCount: changedAfterVerification.length,
    delivery: deliveryStats(reminderQueue),
    evaluatedCount: evaluated.length,
    generatedAt: new Date().toISOString(),
    hefamaaAttention: hefamaaAttention.slice(0, 5).map(publicRow),
    hefamaaAttentionCount: hefamaaAttention.length,
    reminderQueue: reminderQueue.slice(0, 5).map(publicRow),
    reminderQueueCount: reminderQueue.length,
    renewalOverdueCount: evaluated.filter((row) => row.status_key === "RENEWAL_OVERDUE").length,
    staleCacheBlockedCount: staleCache.filter((row) => row.next_action_owner === "facility" && row.reminder_due).length,
    staleCacheCount: staleCache.length,
  };

  return {
    availableProviders: {
      activeEmailProvider: process.env.EMAIL_PROVIDER?.trim() || "auto",
      emailWebhook: Boolean(process.env.EMAIL_NOTIFICATION_WEBHOOK_URL),
      gmailSmtp: Boolean(process.env.GMAIL_SMTP_USER && process.env.GMAIL_SMTP_APP_PASSWORD),
      resend: Boolean(process.env.RESEND_API_KEY && process.env.NOTIFICATION_FROM_EMAIL),
      smsWebhook: Boolean(process.env.SMS_NOTIFICATION_WEBHOOK_URL),
      termii: Boolean(process.env.TERMII_API_KEY),
    },
    cacheFreshness: { logsMtime, portalMtime, qaMtime },
    channelStatusCounts,
    compactCache: { ageMs: 0, fresh: true, source: "route" },
    facilitiesRequiringAttention: intelligence.reminderQueueCount + intelligence.hefamaaAttentionCount,
    intelligence,
    notificationRules: Array.isArray(rulesFile.rules) ? rulesFile.rules : [],
    outboxCount: logs.length,
    recentMessages: logs.slice(0, 12).map(compactLog),
    reminderCandidates: intelligence.reminderQueueCount,
    scheduler: { activeRules: (rulesFile.rules ?? []).filter((rule) => rule.enabled !== false).length },
    statusCounts: countByStatus,
    totalFailed: countByStatus.failed ?? 0,
    totalPending: countByStatus.pending ?? 0,
    totalResolved: countByStatus.resolved ?? 0,
    totalSent: countByStatus.sent ?? 0,
    totalSkipped: countByStatus.skipped ?? 0,
  };
}

export async function GET() {
  try {
    return ok(await buildSummary());
  } catch (error) {
    return fail(error, 500);
  }
}
