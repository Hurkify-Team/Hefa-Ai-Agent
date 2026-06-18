import { readPortalListCacheLightweight } from "@/lib/portalCacheStore";

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function facilityIdentityKey(record: { category?: string; facilityName?: string; hefamaaId?: string }) {
  const name = normalize(record.facilityName);
  const category = normalize(record.category);
  const idWithoutYear = normalize(record.hefamaaId).replace(/\b20\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
  return [name || idWithoutYear, category].filter(Boolean).join("|");
}

export function isGlobalFacilityTotalQuestion(question: string) {
  const lower = question.toLowerCase();
  if (!/\bfacilit(?:y|ies)\b/.test(lower)) return false;
  if (!/\b(total|how many|count|number of)\b/.test(lower)) return false;

  // These words mean the user is asking for a filtered count, not the global total.
  if (/\b(category|categories|lga|local government|status|stage|workflow|document queried|pending|approved|new registration|renewal|existing|doctor|nurse|staff|missing|duplicate)\b/.test(lower)) {
    return false;
  }

  return /\b(total|overall|all|we have|available|in total|how many)\b/.test(lower);
}

export function buildFastPortalFacilitySummary() {
  const records = readPortalListCacheLightweight();
  const facilityKeys = new Set<string>();
  const categoryCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const applicationCounts = new Map<string, number>();

  for (const record of records) {
    const key = facilityIdentityKey(record);
    if (key) facilityKeys.add(key);

    const category = clean(record.category) || "Unknown Category";
    const status = clean(record.normalizedStatus || record.registrationStatus) || "unknown_status";
    const applicationType = clean(record.applicationType) || "unknown";

    categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    applicationCounts.set(applicationType, (applicationCounts.get(applicationType) ?? 0) + 1);
  }

  const rows = Array.from(categoryCounts.entries())
    .map(([Category, Count]) => ({ Category, Count }))
    .sort((a, b) => b.Count - a.Count || a.Category.localeCompare(b.Category));

  return {
    applicationCounts: Object.fromEntries(applicationCounts.entries()),
    categoryRows: rows,
    distinctFacilities: facilityKeys.size,
    indexedRows: records.length,
    statusCounts: Object.fromEntries(statusCounts.entries()),
  };
}

export function answerGlobalFacilityTotalQuestion(question: string) {
  const summary = buildFastPortalFacilitySummary();
  const answer = summary.indexedRows
    ? "The latest HEFAMAA portal scan has " + summary.indexedRows.toLocaleString() + " indexed portal rows and " + summary.distinctFacilities.toLocaleString() + " distinct facilities. Use the distinct facilities number as the operational facility total; indexed rows can be higher because one facility may have multiple yearly renewal portal records."
    : "No portal scan cache is available yet. Run Quick Scan or Full Detail Scan before asking for the total facility count.";

  return {
    answer,
    rows: summary.categoryRows.slice(0, 12),
    summary: { ...summary, question },
  };
}
