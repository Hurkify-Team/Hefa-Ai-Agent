import { safeJsonParse, safeJsonResponse } from "@/lib/safeJson";
import { z } from "zod";

import type { ConversationMemory } from "@/lib/conversationMemory";

export const supportedIntentSchema = z.enum([
  "count_facilities",
  "list_facilities",
  "search_facility",
  "facility_details",
  "count_by_category",
  "count_by_lga",
  "count_missing_fields",
  "count_pending_requirements",
  "list_pending_requirements",
  "count_expired_accreditation",
  "list_expired_accreditation",
  "count_staff",
  "bed_distribution",
  "compare_categories",
  "duplicate_check",
  "recent_updates",
  "notification_targets",
  "notification_document_queried",
  "notification_reminders_today",
  "notification_hefamaa_action",
  "notification_final_approval_pending",
  "notification_overdue_renewal",
  "notification_stale_cache",
  "notification_changed_status",
  "generate_report",
  "unknown",
]);

const detectedIntentSchema = z.object({
  intent: supportedIntentSchema,
  entities: z.object({
    category: z.string().nullable().default(null),
    lga: z.string().nullable().default(null),
    lcda: z.string().nullable().default(null),
    facilityName: z.string().nullable().default(null),
    hefNo: z.string().nullable().default(null),
    status: z.string().nullable().default(null),
    dateRange: z.string().nullable().default(null),
    field: z.string().nullable().default(null),
  }),
  dataSources: z.array(z.enum(["google_sheet", "portal_cache"])).default([]),
  requiresCalculation: z.boolean().default(false),
  requiresList: z.boolean().default(false),
  requiresSummary: z.boolean().default(false),
  confidence: z.number().min(0).max(1).default(0.5),
});

export type DetectedIntent = z.infer<typeof detectedIntentSchema>;

const CATEGORY_ALIASES: Array<[RegExp, string]> = [
  [/\b(labs?|laborator(?:y|ies)|medical labs?)\b/i, "LABORATORY"],
  [/\b(hospitals?)\b/i, "HOSPITAL"],
  [/\b(clinics?)\b/i, "CLINIC"],
  [/\b(diagnostic|diagnostics|radiology|scan|x\s*-?ray)\b/i, "DIAGNOSTICS"],
  [/\b(maternit(?:y|ies)|maternity home)\b/i, "MATERNITY HOME"],
  [/\b(dental|dentist)\b/i, "DENTAL"],
  [/\b(physiotherapy|physio)\b/i, "PHYSIOTHERAPY"],
  [/\b(pharmacy|pharmacies)\b/i, "PHARMACY"],
  [/\b(eye clinic|optometry|optometrist)\b/i, "EYE CLINIC"],
];

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function detectCategory(question: string) {
  return CATEGORY_ALIASES.find(([pattern]) => pattern.test(question))?.[1] ?? null;
}

function shouldUseMemoryContext(question: string) {
  const lower = question.toLowerCase();

  // Global count questions must not inherit a previous category such as CLINIC.
  // Memory is only for clear follow-ups like "what about that category?".
  if (/\bfacilit(?:y|ies)\b/.test(lower) && /\b(total|overall|all|how many|count|number of|we have|in total)\b/.test(lower)) {
    return false;
  }

  if (/\b(across all|all categories|overall|entire database|whole database)\b/.test(lower)) {
    return false;
  }

  return /\b(this|that|these|those|same|selected|previous|there|them)\b/.test(lower) || /^(and|also|what about|how about)\b/i.test(question.trim());
}

function detectLga(question: string) {
  const match = question.match(/\bin\s+([a-z][a-z\s-]+?)\s+(?:local government|lga)\b/i) ?? question.match(/\b([a-z][a-z\s-]+?)\s+(?:local government|lga)\b/i);
  return clean(match?.[1] ?? "") || null;
}

function detectFacilityName(question: string) {
  const patterns = [
    /\bdoes\s+(.+?)\s+(?:have|has|record|recorded)\b/i,
    /\bfor\s+(.+?)\s+(?:have|has|record|recorded)\b/i,
    /\b(?:for|of|about|called|named)\s+(.+?)\??$/i,
    /\bfacility\s+(.+?)\??$/i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) return clean(match[1].replace(/[?.!]+$/g, ""));
  }
  return null;
}

function detectField(question: string) {
  const text = question.toLowerCase();
  if (/medical professional in charge|medical professional in-charge|medical officer in charge|operating officer|professional in-charge|professional in charge|officer in charge/.test(text)) return "operating_officer";
  if (/admission beds?/.test(text)) return "admission_beds";
  if (/observation beds?/.test(text)) return "observation_beds";
  if (/no of couches|couches?/.test(text)) return "couches";
  if (/hefa\s*no|hef\/?no|hef no|hefamaa no|hefamaa number|hefa number|facility code|facility id/.test(text)) return "hef_no";
  if (/address|location|located/.test(text)) return "address";
  if (/phone|contact|telephone/.test(text)) return "contact";
  if (/email|e-mail/.test(text)) return "email";
  if (/owner|proprietor/.test(text)) return "owner_name";
  if (/doctor/.test(text)) return "doctors_count";
  if (/nurse/.test(text)) return "nurses_count";
  if (/status|stage|workflow/.test(text)) return "registration_status";
  return null;
}

function baseIntent(question: string, memory?: ConversationMemory): DetectedIntent {
  const lower = question.toLowerCase();
  const useMemoryContext = shouldUseMemoryContext(question);
  const explicitCategory = detectCategory(question);
  const field = detectField(question);
  const bedLocation = field && /admission_beds|observation_beds|couches/.test(field) ? clean(question.match(/\bin\s+([a-z][a-z\s-]+?)\??$/i)?.[1] ?? "") || null : null;
  const explicitLga = detectLga(question) ?? bedLocation;
  const category = explicitCategory ?? (useMemoryContext ? memory?.lastCategory : null) ?? null;
  const lga = explicitLga ?? (useMemoryContext ? memory?.lastLGA : null) ?? null;
  let intent: DetectedIntent["intent"] = "unknown";
  let sources: DetectedIntent["dataSources"] = [];

  if (/changed status|status changed|changed after verification/.test(lower)) {
    intent = "notification_changed_status";
    sources = ["portal_cache"];
  } else if (/stale cache|cache older|outdated cache/.test(lower)) {
    intent = "notification_stale_cache";
    sources = ["portal_cache"];
  } else if (/overdue renewal|renewal overdue|not renewed|no renewal activity/.test(lower)) {
    intent = "notification_overdue_renewal";
    sources = ["portal_cache"];
  } else if (/hefamaa action|staff action|agency action|internal attention|hefamaa attention/.test(lower)) {
    intent = "notification_hefamaa_action";
    sources = ["portal_cache"];
  } else if (/final approval pending|awaiting final approval/.test(lower)) {
    intent = "notification_final_approval_pending";
    sources = ["portal_cache"];
  } else if (/document(s)? queried/.test(lower) && /how many|count|total|number|show|which|list/.test(lower)) {
    intent = "notification_document_queried";
    sources = ["portal_cache"];
  } else if (/require reminders today|requires reminders today|reminder queue|need reminders|needs reminder|require reminder|send reminders/.test(lower)) {
    intent = "notification_reminders_today";
    sources = ["portal_cache"];
  } else if (/\b(send|notify|remind|notification|email|sms)\b/.test(lower)) {
    intent = "notification_targets";
    sources = ["google_sheet", "portal_cache"];
  } else if (/duplicate/.test(lower)) {
    intent = "duplicate_check";
    sources = ["google_sheet"];
  } else if (/recent|latest|last scanned|updated/.test(lower)) {
    intent = "recent_updates";
    sources = ["portal_cache"];
  } else if (/pending requirement|document quer|missing document|pending document/.test(lower)) {
    intent = /\b(list|show|which|who)\b/.test(lower) ? "list_pending_requirements" : "count_pending_requirements";
    sources = ["portal_cache"];
  } else if (/expired accreditation|expired licence|expired license/.test(lower)) {
    intent = /\b(list|show|which|who)\b/.test(lower) ? "list_expired_accreditation" : "count_expired_accreditation";
    sources = ["portal_cache"];
  } else if (field === "admission_beds" || field === "observation_beds" || field === "couches") {
    intent = "bed_distribution";
    sources = ["portal_cache"];
  } else if (/\bdoctor|nurse|staff|complement\b/.test(lower) && /how many|count|total|number/.test(lower)) {
    intent = "count_staff";
    sources = ["portal_cache"];
  } else if (/\b(category|categories)\b/.test(lower) && /count|breakdown|summary|total|how many/.test(lower)) {
    intent = "count_by_category";
    sources = lower.includes("portal") ? ["portal_cache"] : ["google_sheet"];
  } else if (/\b(lga|local government)\b/.test(lower) && /count|breakdown|summary|total|how many/.test(lower)) {
    intent = "count_by_lga";
    sources = lower.includes("portal") ? ["portal_cache"] : ["google_sheet"];
  } else if (/missing|blank|empty|incomplete/.test(lower)) {
    intent = "count_missing_fields";
    sources = ["google_sheet"];
  } else if (/\b(list|show|give me|provide)\b/.test(lower) && /facilit/.test(lower)) {
    intent = "list_facilities";
    sources = lower.includes("portal") ? ["portal_cache"] : ["google_sheet"];
  } else if (/how many|count|total|number of/.test(lower)) {
    intent = "count_facilities";
    sources = lower.includes("portal") || /status|workflow|pending|approved|quer/.test(lower) ? ["portal_cache"] : ["google_sheet"];
  } else if (field || /\bfacility\b|hef\/?no|hef no|who is|what is|where is/.test(lower)) {
    intent = field === "hef_no" ? "search_facility" : "facility_details";
    sources = field === "hef_no" ? ["google_sheet"] : ["portal_cache", "google_sheet"];
  }

  const status = /document\s+quer/i.test(question) ? "document queried"
    : /final\s+approval/i.test(question) ? "final approval pending"
      : /pending/i.test(question) ? "pending"
        : /approved/i.test(question) ? "approved"
          : null;

  const detectedFacilityName = detectFacilityName(question);
  const isBedField = field === "admission_beds" || field === "observation_beds" || field === "couches";
  const shouldIgnoreBedFacilityName = isBedField && !/\bdoes\b/i.test(question) && (/\b(total|across all|by lga|by local government|grouped by|number of)\b/i.test(question) || Boolean(lga));
  const shouldIgnoreCodeFacilityName = field === "hef_no";

  return {
    intent,
    entities: {
      category,
      lga,
      lcda: null,
      facilityName: shouldIgnoreBedFacilityName || shouldIgnoreCodeFacilityName ? null : detectedFacilityName ?? (useMemoryContext ? memory?.lastFacilityName : null) ?? null,
      hefNo: clean(question.match(/\b(?:hefa\s*no|hef\/?no|hef no|hefamaa no|hefamaa number|hefa number|facility code|facility id)\s*[:#-]?\s*([a-z0-9/-]+)/i)?.[1] ?? "") || null,
      status,
      dateRange: clean(question.match(/\b(20\d{2}|today|yesterday|this week|this month|this year|last week|last month)\b/i)?.[1] ?? "") || null,
      field,
    },
    dataSources: sources,
    requiresCalculation: /how many|count|total|summary|breakdown|compare|duplicate|missing/.test(lower),
    requiresList: /\b(list|show|which|who should|give me|provide)\b/.test(lower),
    requiresSummary: /summary|report|breakdown|analytics|analysis/.test(lower),
    confidence: intent === "unknown" ? 0.2 : 0.76,
  };
}

function extractJson(value: string) {
  const fenced = value.match(new RegExp("```(?:json)?\\s*([\\s\\S]*?)```", "i"))?.[1];
  const raw = fenced ?? value;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
}

async function geminiDetect(question: string, memory?: ConversationMemory): Promise<DetectedIntent | null> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return null;

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.HEFAI_INTENT_TIMEOUT_MS || 1400));

  try {
    const prompt = [
      "You are the HEFAI intent detector for HEFAMAA facility data questions.",
      "Return strict JSON only. Do not answer the user.",
      "Supported intents: count_facilities, list_facilities, search_facility, facility_details, count_by_category, count_by_lga, count_missing_fields, count_pending_requirements, list_pending_requirements, count_expired_accreditation, list_expired_accreditation, count_staff, bed_distribution, compare_categories, duplicate_check, recent_updates, notification_targets, notification_document_queried, notification_reminders_today, notification_hefamaa_action, notification_final_approval_pending, notification_overdue_renewal, notification_stale_cache, notification_changed_status, generate_report, unknown.",
      "Use dataSources google_sheet for spreadsheet/database questions and portal_cache for portal scan/workflow/status/accreditation/staff questions. Use both when needed.",
      "Previous memory: " + JSON.stringify(memory ?? {}),
      "Question: " + question,
      "Return shape: {\"intent\":string,\"entities\":{\"category\":string|null,\"lga\":string|null,\"lcda\":string|null,\"facilityName\":string|null,\"hefNo\":string|null,\"status\":string|null,\"dateRange\":string|null,\"field\":string|null},\"dataSources\":[\"google_sheet\"|\"portal_cache\"],\"requiresCalculation\":boolean,\"requiresList\":boolean,\"requiresSummary\":boolean,\"confidence\":number}",
    ].join("\n");

    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json", temperature: 0.1 } }),
    });

    if (!response.ok) return null;
    const payload = await safeJsonResponse<Record<string, any>>(response, "lib/intentDetector.ts");
    const text = payload?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? "").join("") ?? "";
    return detectedIntentSchema.parse(safeJsonParse(extractJson(text), "lib/intentDetector.ts Gemini intent"));
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function detectIntent(question: string, memory?: ConversationMemory): Promise<DetectedIntent> {
  const fast = baseIntent(question, memory);

  // Fast, local detection keeps the chat responsive. Gemini is used as an
  // enhancer only when the local detector is uncertain, so no database rows are
  // ever sent to the model and normal answers stay under the target latency.
  if (fast.confidence >= 0.7 || process.env.HEFAI_DISABLE_GEMINI_INTENT === "true") {
    return fast;
  }

  return (await geminiDetect(question, memory)) ?? fast;
}
