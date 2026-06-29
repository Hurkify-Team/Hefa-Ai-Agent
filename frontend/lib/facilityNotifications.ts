import { existsSync, readFileSync, writeFileSync } from "fs";

import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";
import { z } from "zod";

import { buildPortalCacheFreshnessPlan } from "@/lib/portalCacheFreshness";
import {
  readPortalDetailsCacheLightweight,
  readPortalListCacheLightweight,
  type LightweightPortalFacilityDetailRecord,
  type LightweightPortalFacilityRecord,
} from "@/lib/portalCacheStore";

export const notificationChannelSchema = z.enum(["email", "sms"]);
export const notificationTemplateSchema = z.enum([
  "document_query",
  "incomplete_registration",
  "provisional_license_ready",
  "status_stage_update",
  "custom",
]);

export const facilityNotificationRequestSchema = z.object({
  category: z.string().trim().optional().or(z.literal("")),
  channels: z.array(notificationChannelSchema).min(1).default(["email"]),
  customMessage: z.string().trim().optional().or(z.literal("")),
  facilityQuery: z.string().trim().optional().or(z.literal("")),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  queryReason: z.string().trim().optional().or(z.literal("")),
  sendNow: z.boolean().default(false),
  status: z.string().trim().optional().or(z.literal("")),
  subject: z.string().trim().optional().or(z.literal("")),
  template: notificationTemplateSchema.default("status_stage_update"),
});

export type FacilityNotificationRequest = z.infer<typeof facilityNotificationRequestSchema>;
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;
export type NotificationTemplate = z.infer<typeof notificationTemplateSchema>;

export type FacilityNotificationTarget = {
  category: string;
  email: string;
  facilityName: string;
  phone: string;
  portalStatus: string;
  renewalYear: number | null;
};

export type NotificationOutboxMessage = {
  body: string;
  channel: NotificationChannel;
  createdAt: string;
  destination: string;
  facilityName: string;
  id: string;
  provider: "local_outbox" | "webhook";
  status: "queued" | "sent" | "failed" | "skipped";
  subject: string;
  template: NotificationTemplate;
  error?: string;
};

type NotificationStore = {
  messages: NotificationOutboxMessage[];
};

const STATUS_TEMPLATES: Record<Exclude<NotificationTemplate, "custom">, { subject: string; body: (target: FacilityNotificationTarget, reason: string) => string }> = {
  document_query: {
    subject: "HEFAMAA portal document query requires your attention",
    body: (target, reason) => [
      "Dear " + target.facilityName + ",",
      "HEFAMAA has a document query on your portal record.",
      "Reason/Action required: " + (reason || "Please log in to your E-HEFAMAA portal and review the query details."),
      "Kindly correct the required information or upload the requested document so your application can continue.",
      "Current portal status: " + (target.portalStatus || "Not available") + ".",
    ].join("\n\n"),
  },
  incomplete_registration: {
    subject: "Reminder to complete your HEFAMAA registration or renewal",
    body: (target) => [
      "Dear " + target.facilityName + ",",
      "Your HEFAMAA registration or renewal is not yet complete on the portal.",
      "Please log in to the E-HEFAMAA portal, complete all required steps, and submit any pending payment or document information.",
      "Current portal status: " + (target.portalStatus || "Not available") + ".",
    ].join("\n\n"),
  },
  provisional_license_ready: {
    subject: "Your HEFAMAA provisional license is ready for download",
    body: (target) => [
      "Dear " + target.facilityName + ",",
      "Your HEFAMAA provisional license for the current year is ready.",
      "Please log in to your E-HEFAMAA portal to download the license document.",
      "Current portal status: " + (target.portalStatus || "Registration approved") + ".",
    ].join("\n\n"),
  },
  status_stage_update: {
    subject: "HEFAMAA portal application status update",
    body: (target) => [
      "Dear " + target.facilityName + ",",
      "This is a HEFAMAA status update for your facility record.",
      "Current portal status: " + (target.portalStatus || "Not available") + ".",
      "Please continue monitoring your portal and respond promptly to any required action.",
    ].join("\n\n"),
  },
};

function notificationStorePath() {
  return configuredRuntimeFile("NOTIFICATION_OUTBOX_PATH", "notification-outbox.json");
}

function readStore(): NotificationStore {
  const file = notificationStorePath();
  if (!existsSync(file)) return { messages: [] };

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { messages: Array.isArray(parsed.messages) ? parsed.messages : [] };
  } catch {
    return { messages: [] };
  }
}

function writeStore(store: NotificationStore) {
  const file = notificationStorePath();
  ensureRuntimeDataDirForFile(file);
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function detailText(detail: LightweightPortalFacilityDetailRecord) {
  return clean(detail.bodyText || detail.text);
}

function emailsFromText(text: string) {
  return Array.from(new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((email) => email.toLowerCase())));
}

function phoneFromText(text: string) {
  const lines = text.split("\n").map(clean).filter(Boolean);
  const phoneLabel = lines.findIndex((line) => /^PHONE NUMBER$|^PHONE$|^CONTACT$/i.test(line));
  if (phoneLabel >= 0) {
    const next = clean(lines[phoneLabel + 1]);
    if (next) return next;
  }
  return clean(text.match(/(?:\+?234|0)\d[\d\s-]{7,}/)?.[0] ?? "");
}

function targetFromDetail(detail: LightweightPortalFacilityDetailRecord): FacilityNotificationTarget {
  const text = detailText(detail);
  const emails = emailsFromText(text);
  return {
    category: clean(detail.category),
    email: emails[emails.length - 1] ?? "",
    facilityName: clean(detail.facilityName),
    phone: phoneFromText(text),
    portalStatus: clean(detail.registrationStatus || detail.normalizedStatus),
    renewalYear: detail.renewalYear ?? null,
  };
}

function targetFromRecord(record: LightweightPortalFacilityRecord): FacilityNotificationTarget {
  const text = clean(record.text);
  return {
    category: clean(record.category),
    email: emailsFromText(text).at(-1) ?? "",
    facilityName: clean(record.facilityName),
    phone: phoneFromText(text),
    portalStatus: clean(record.registrationStatus || record.normalizedStatus),
    renewalYear: record.renewalYear ?? null,
  };
}

function matchesFilter(target: FacilityNotificationTarget, input: FacilityNotificationRequest) {
  const query = normalize(input.facilityQuery);
  const category = normalize(input.category);
  const status = normalize(input.status);
  const haystack = normalize([target.facilityName, target.category, target.portalStatus, target.email, target.phone].join(" "));

  if (query && !haystack.includes(query)) return false;
  if (category && normalize(target.category) !== category) return false;
  if (status && !normalize(target.portalStatus).includes(status)) return false;
  return true;
}

function uniqueTargets(targets: FacilityNotificationTarget[]) {
  const seen = new Set<string>();
  const unique: FacilityNotificationTarget[] = [];

  for (const target of targets) {
    const key = [target.facilityName, target.category, target.email, target.phone].map(normalize).join("|");
    if (seen.has(key) || !target.facilityName) continue;
    seen.add(key);
    unique.push(target);
  }

  return unique;
}

export function findNotificationTargets(input: FacilityNotificationRequest) {
  const detailTargets = readPortalDetailsCacheLightweight().map(targetFromDetail);
  const listTargets = readPortalListCacheLightweight().map(targetFromRecord);
  return uniqueTargets([...detailTargets, ...listTargets])
    .filter((target) => matchesFilter(target, input))
    .slice(0, input.limit);
}

function renderNotification(input: FacilityNotificationRequest, target: FacilityNotificationTarget) {
  if (input.template === "custom") {
    const subject = input.subject || "HEFAMAA notification";
    const body = input.customMessage || "Please log in to your E-HEFAMAA portal for the latest update from HEFAMAA.";
    return { body, subject };
  }

  const template = STATUS_TEMPLATES[input.template];
  return {
    body: input.customMessage || template.body(target, input.queryReason || ""),
    subject: input.subject || template.subject,
  };
}

function destinationFor(target: FacilityNotificationTarget, channel: NotificationChannel) {
  return channel === "email" ? target.email : target.phone;
}

async function deliverViaWebhook(message: NotificationOutboxMessage) {
  const url = message.channel === "email" ? process.env.EMAIL_NOTIFICATION_WEBHOOK_URL : process.env.SMS_NOTIFICATION_WEBHOOK_URL;
  if (!url) return { provider: "local_outbox" as const, status: "queued" as const };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message),
  });

  if (!response.ok) {
    throw new Error("Provider webhook returned " + response.status + ".");
  }

  return { provider: "webhook" as const, status: "sent" as const };
}

export async function queueFacilityNotifications(rawInput: unknown) {
  const input = facilityNotificationRequestSchema.parse(rawInput);
  const targets = findNotificationTargets(input);
  const createdAt = new Date().toISOString();
  const messages: NotificationOutboxMessage[] = [];

  for (const target of targets) {
    const rendered = renderNotification(input, target);
    for (const channel of input.channels) {
      const destination = destinationFor(target, channel);
      const baseMessage: NotificationOutboxMessage = {
        body: rendered.body,
        channel,
        createdAt,
        destination,
        facilityName: target.facilityName,
        id: "notif-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
        provider: "local_outbox",
        status: destination ? "queued" : "skipped",
        subject: rendered.subject,
        template: input.template,
        error: destination ? undefined : "No " + channel + " destination was found in the portal cache.",
      };

      if (destination && input.sendNow) {
        try {
          const delivery = await deliverViaWebhook(baseMessage);
          messages.push({ ...baseMessage, provider: delivery.provider, status: delivery.status });
        } catch (error) {
          messages.push({ ...baseMessage, status: "failed", error: error instanceof Error ? error.message : "Delivery failed." });
        }
      } else {
        messages.push(baseMessage);
      }
    }
  }

  const store = readStore();
  store.messages.unshift(...messages);
  writeStore(store);

  return {
    messages,
    summary: getNotificationSummary(),
    targetCount: targets.length,
  };
}

export function getReminderCandidates(limit = 100) {
  const request = facilityNotificationRequestSchema.parse({
    channels: ["email"],
    limit,
    status: "pending",
    template: "status_stage_update",
  });
  const queried = findNotificationTargets({ ...request, status: "queried", limit });
  const pending = findNotificationTargets(request);
  const finalPending = findNotificationTargets({ ...request, status: "final approval pending", limit });
  return uniqueTargets([...queried, ...pending, ...finalPending]).slice(0, limit);
}

export async function queueReminderNotifications(rawInput: unknown = {}) {
  const input = facilityNotificationRequestSchema.parse({
    channels: ["email", "sms"],
    limit: 100,
    template: "status_stage_update",
    ...((rawInput && typeof rawInput === "object") ? rawInput : {}),
  });

  return queueFacilityNotifications(input);
}

export function getNotificationSummary() {
  const store = readStore();
  const messages = store.messages;
  const countByStatus = messages.reduce<Record<string, number>>((acc, message) => {
    acc[message.status] = (acc[message.status] ?? 0) + 1;
    return acc;
  }, {});
  const refreshPlan = buildPortalCacheFreshnessPlan(8);

  return {
    availableProviders: {
      emailWebhook: Boolean(process.env.EMAIL_NOTIFICATION_WEBHOOK_URL),
      smsWebhook: Boolean(process.env.SMS_NOTIFICATION_WEBHOOK_URL),
    },
    cacheFreshness: refreshPlan,
    outboxCount: messages.length,
    recentMessages: messages.slice(0, 12),
    reminderCandidates: getReminderCandidates(25).length,
    statusCounts: countByStatus,
  };
}
