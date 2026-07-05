import type { DetectedIntent } from "@/lib/intentDetector";

export type KnowledgeDataSource = "google_sheet" | "portal_cache";

const SHEET_INTENTS = new Set([
  "count_facilities",
  "list_facilities",
  "search_facility",
  "facility_details",
  "count_by_category",
  "count_by_lga",
  "count_missing_fields",
  "duplicate_check",
  "generate_report",
]);

const PORTAL_INTENTS = new Set([
  "facility_details",
  "count_pending_requirements",
  "list_pending_requirements",
  "count_expired_accreditation",
  "list_expired_accreditation",
  "count_staff",
  "bed_distribution",
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
]);

export function routeDataSources(intent: DetectedIntent, question: string): KnowledgeDataSource[] {
  const lower = question.toLowerCase();
  const requested = new Set(intent.dataSources ?? []);

  if (/portal|scan|scanned|accreditation|inspection|requirements?|status|workflow|staff|doctor|nurse|operating officer|medical officer|professional in-charge|professional in charge|admission beds?|observation beds?|couches?/.test(lower)) {
    requested.add("portal_cache");
  }
  if (/sheet|spreadsheet|google|database|hefa no|hef\/no|hef no|hefamaa no|hefa number|facility code|facility id|missing fields?|duplicate|serial|s\/n/.test(lower)) {
    requested.add("google_sheet");
  }

  if (!requested.size) {
    if (SHEET_INTENTS.has(intent.intent)) requested.add("google_sheet");
    if (PORTAL_INTENTS.has(intent.intent)) requested.add("portal_cache");
  }

  if (!requested.size) requested.add("portal_cache");
  return [...requested].filter((source): source is KnowledgeDataSource => source === "google_sheet" || source === "portal_cache");
}
