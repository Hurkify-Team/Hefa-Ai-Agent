import { readPortalDetailsCacheLightweight, readPortalListCacheLightweight } from "@/lib/portalCacheStore";

export type PortalCacheRefreshPriority = "high" | "normal" | "low";

export type PortalCacheRefreshCandidate = {
  capturedAt: string | null;
  category: string;
  facilityName: string;
  portalStatus: string;
  priority: PortalCacheRefreshPriority;
  reason: string;
  renewalYear: number | null;
};

const HIGH_CHANGE_STATUS = /document\s+queried|query|pending\s+document|payment\s+approved|upload\s+payment|inspection|final\s+approval\s+pending/i;

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function keyFor(value: { category?: unknown; facilityName?: unknown; hefamaaId?: unknown }) {
  return [value.facilityName, value.category, value.hefamaaId].map((part) => clean(part).toLowerCase()).join("|");
}

function ageInHours(value: string | null | undefined) {
  if (!value) return Number.POSITIVE_INFINITY;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (60 * 60 * 1000);
}

function priorityFor(status: string, capturedAt: string | null): { priority: PortalCacheRefreshPriority; reason: string } {
  const ageHours = ageInHours(capturedAt);
  if (!capturedAt) {
    return { priority: "high", reason: "No detail capture exists yet for this portal row." };
  }

  if (HIGH_CHANGE_STATUS.test(status)) {
    if (ageHours >= 24) {
      return { priority: "high", reason: "Queried or pending facilities can change quickly, so the cache should be rechecked daily." };
    }
    return { priority: "normal", reason: "Pending/queried facility was checked recently, but should remain on close watch." };
  }

  if (ageHours >= 30 * 24) {
    return { priority: "normal", reason: "Cached detail is older than 30 days." };
  }

  return { priority: "low", reason: "Cache is recent enough for routine lookup." };
}

export function buildPortalCacheFreshnessPlan(limit = 150) {
  const details = readPortalDetailsCacheLightweight();
  const detailByKey = new Map(details.map((detail) => [keyFor(detail), detail]));
  const rows = readPortalListCacheLightweight().map((record) => {
    const detail = detailByKey.get(keyFor(record));
    const status = clean(detail?.registrationStatus || record.registrationStatus || record.normalizedStatus);
    const capturedAt = detail?.capturedAt ?? null;
    const priority = priorityFor(status, capturedAt);

    return {
      capturedAt,
      category: clean(detail?.category || record.category),
      facilityName: clean(detail?.facilityName || record.facilityName),
      portalStatus: status,
      renewalYear: detail?.renewalYear ?? record.renewalYear ?? null,
      ...priority,
    };
  });

  const priorityRank: Record<PortalCacheRefreshPriority, number> = { high: 0, normal: 1, low: 2 };
  const due = rows
    .filter((row) => row.priority !== "low")
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.facilityName.localeCompare(b.facilityName));

  return {
    due: due.slice(0, Math.max(1, Math.min(limit, 1000))),
    highPriority: rows.filter((row) => row.priority === "high").length,
    normalPriority: rows.filter((row) => row.priority === "normal").length,
    totalPortalRows: rows.length,
    totalWithDetails: details.length,
  };
}
