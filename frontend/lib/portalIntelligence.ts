import { getPortalFacilityExportRecords, getPortalFacilitySummary, type PortalFacilityRecord } from "@/lib/playwrightPortal";
import { normalizeLGA } from "@/lib/normalizers";
import { summarizePortalScanHistory, writePortalScanSnapshot } from "@/lib/portalScanSnapshots";

export type PortalRecordFilters = {
  applicationType?: string;
  category?: string;
  facilityType?: string;
  lga?: string;
  limit?: number;
  query?: string;
  status?: string;
  year?: number;
};

const DETAIL_ALIASES = {
  address: ["address", "facility address"],
  doctors: ["doctor", "doctors", "medical doctor", "medical doctors"],
  email: ["email", "facility e-mail", "facility email"],
  lga: ["lga", "local government"],
  nurses: ["nurse", "nurses"],
  owner: ["owner", "owner's name", "owner name"],
  phone: ["contact", "phone", "telephone"],
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase();
}

function normalizedToken(value: unknown) {
  return normalize(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function visibleFieldValue(record: PortalFacilityRecord, aliases: string[]) {
  const fields = record.visibleFields ?? {};
  for (const [header, value] of Object.entries(fields)) {
    const headerText = normalizedToken(header);
    if (aliases.some((alias) => headerText.includes(normalizedToken(alias)))) {
      const fieldValue = clean(value);
      if (fieldValue) return fieldValue;
    }
  }
  return "";
}

function recordSearchText(record: PortalFacilityRecord) {
  return [
    record.facilityName,
    record.hefamaaId,
    record.category,
    record.registrationStatus,
    record.normalizedStatus,
    record.applicationType,
    record.renewalYear,
    record.text,
    ...Object.entries(record.visibleFields ?? {}).flatMap(([header, value]) => [header, value]),
  ].join(" ").toLowerCase();
}

function facilityKey(record: PortalFacilityRecord) {
  return [normalizedToken(record.facilityName), normalizedToken(record.category)].join("|");
}

export function latestPortalFacilities(records = getPortalFacilityExportRecords()) {
  const latest = new Map<string, PortalFacilityRecord>();
  for (const record of records) {
    const key = facilityKey(record);
    const existing = latest.get(key);
    if (!existing || (record.renewalYear ?? 0) > (existing.renewalYear ?? 0)) latest.set(key, record);
  }
  return Array.from(latest.values());
}

function facilityType(record: PortalFacilityRecord, records: PortalFacilityRecord[]) {
  const sameFacility = records.filter((candidate) => facilityKey(candidate) === facilityKey(record));
  const years = new Set(sameFacility.map((candidate) => candidate.renewalYear).filter(Boolean));
  if (years.size > 1 || sameFacility.some((candidate) => candidate.applicationType === "renewal")) return "existing_facility";
  if (record.applicationType === "new_registration") return "new_registration";
  return "unknown";
}

export function filterPortalFacilityRecords(filters: PortalRecordFilters = {}) {
  const allRecords = getPortalFacilityExportRecords();
  const query = normalize(filters.query);
  const category = normalize(filters.category);
  const status = normalize(filters.status);
  const applicationType = normalize(filters.applicationType);
  const requestedFacilityType = normalize(filters.facilityType);
  const requestedLga = filters.lga ? normalizeLGA(filters.lga).toLowerCase() : "";
  const limit = filters.limit ? Math.max(1, Math.min(filters.limit, 5000)) : undefined;

  const records = allRecords.filter((record) => {
    if (query && !recordSearchText(record).includes(query)) return false;
    if (category && normalize(record.category) !== category) return false;
    if (status && normalize(record.normalizedStatus) !== status && normalize(record.registrationStatus) !== status) return false;
    if (applicationType && normalize(record.applicationType) !== applicationType) return false;
    if (filters.year && record.renewalYear !== filters.year) return false;
    if (requestedFacilityType && normalize(facilityType(record, allRecords)) !== requestedFacilityType) return false;
    if (requestedLga) {
      const lga = visibleFieldValue(record, DETAIL_ALIASES.lga);
      if (!lga || normalizeLGA(lga).toLowerCase() !== requestedLga) return false;
    }
    return true;
  });

  return {
    allRecords,
    records: limit ? records.slice(0, limit) : records,
    totalMatches: records.length,
  };
}

function bestFacilityMatch(query: string) {
  const normalizedQuery = normalizedToken(query);
  if (!normalizedQuery) return null;
  const records = latestPortalFacilities();
  const exact = records.find((record) => normalizedToken(record.facilityName) === normalizedQuery || normalizedToken(record.hefamaaId) === normalizedQuery);
  if (exact) return exact;
  return records.find((record) => normalizedToken(record.facilityName).includes(normalizedQuery) || normalizedToken(record.hefamaaId).includes(normalizedQuery)) ?? null;
}

function extractFacilityLookup(question: string) {
  const patterns = [
    /(?:address|status|category|hef(?:amaa)?(?:\s*number)?|doctor|doctors|nurse|nurses)\s+(?:for|of|in)\s+(.+)$/i,
    /(?:tell me about|show|find|search)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) return match[1].replace(/[?.!]+$/g, "").trim();
  }
  return "";
}

export function seedPortalScanSnapshotFromCurrentCache() {
  const records = getPortalFacilityExportRecords();
  const summary = getPortalFacilitySummary();
  if (!records.length) {
    throw new Error("No portal scan cache is available to seed a snapshot. Run Full Scan first.");
  }

  return writePortalScanSnapshot({
    categoryCounts: summary.categoryCounts,
    distinctFacilities: summary.totalFacilities,
    existingFacilities: summary.facilityTypeCounts.existing_facility,
    indexedRows: summary.totalPortalRecords,
    newFacilities: summary.facilityTypeCounts.new_registration,
    portalReportedRecords: summary.portalReportedRecords,
    records,
    scannedPages: summary.scanProgress.scannedPages,
    scannedRecords: summary.scanProgress.scannedRecords,
    statusCounts: summary.statusCounts,
    unknownFacilities: summary.facilityTypeCounts.unknown,
  });
}

export function answerPortalQuestion(question: string) {
  const summary = getPortalFacilitySummary();
  const history = summarizePortalScanHistory();
  const lower = question.toLowerCase();

  if (/daily|today|weekly|monthly|this week|this month|last 7 days|last 30 days/i.test(question)) {
    return {
      question,
      answer: history.note ?? "Portal movement is available from scan snapshots. Added rows are computed by comparing stable portal record keys between scan baselines.",
      summary: {
        daily: history.daily,
        weekly: history.weekly,
        monthly: history.monthly,
        snapshotCount: history.snapshotCount,
      },
    };
  }

  if (/total|how many|count/i.test(question)) {
    if (/new registration|new facilities|new facility/i.test(question)) {
      return { question, answer: summary.facilityTypeCounts.new_registration + " facilities are currently classified as new registrations in the portal index." };
    }
    if (/renewal|existing/i.test(question)) {
      return { question, answer: summary.facilityTypeCounts.existing_facility + " facilities are currently classified as existing or renewal facilities in the portal index." };
    }
    if (/categor/i.test(question)) {
      return { question, answer: "Portal facilities are currently grouped into " + summary.categoryCounts.length + " categories.", rows: summary.categoryCounts };
    }
    const categoryMatch = question.match(/(?:in|under|category)\s+([a-z0-9&/()\-\s]+)$/i);
    if (categoryMatch?.[1]) {
      const category = categoryMatch[1].replace(/[?.!]+$/g, "").trim().toLowerCase();
      const entry = summary.categoryCounts.find((item) => item.category.toLowerCase() === category || item.category.toLowerCase().includes(category));
      return { question, answer: entry ? entry.count + " distinct facilities are in " + entry.category + "." : "No matching portal category was found for " + categoryMatch[1].trim() + "." };
    }
    return { question, answer: "The latest portal scan indexed " + summary.totalPortalRecords + " valid portal rows and " + summary.totalFacilities + " distinct facilities. The portal reported " + (summary.portalReportedRecords ?? "unknown") + " rows." };
  }

  const facilityLookup = extractFacilityLookup(question);
  const facility = bestFacilityMatch(facilityLookup);
  if (facility) {
    const address = visibleFieldValue(facility, DETAIL_ALIASES.address);
    const lga = visibleFieldValue(facility, DETAIL_ALIASES.lga);
    const doctors = visibleFieldValue(facility, DETAIL_ALIASES.doctors);
    const nurses = visibleFieldValue(facility, DETAIL_ALIASES.nurses);
    const detailsMissing = !address && !lga && !doctors && !nurses;

    if (/address/i.test(question)) {
      return { question, answer: address ? facility.facilityName + " address is " + address + "." : "I found " + facility.facilityName + " in the portal index, but its address is not in the list scan cache yet. Run detail enrichment for this facility to answer address offline.", record: facility };
    }
    if (/doctor/i.test(question)) {
      return { question, answer: doctors ? facility.facilityName + " has " + doctors + " doctors in the cached portal details." : "I found " + facility.facilityName + ", but doctor complement is not in the list scan cache yet. It requires detail enrichment from the facility record page.", record: facility };
    }
    if (/nurse/i.test(question)) {
      return { question, answer: nurses ? facility.facilityName + " has " + nurses + " nurses in the cached portal details." : "I found " + facility.facilityName + ", but nurse complement is not in the list scan cache yet. It requires detail enrichment from the facility record page.", record: facility };
    }
    return {
      question,
      answer: [
        facility.facilityName + " is in " + (facility.category || "an unknown category") + ".",
        "E-HEFAMAA ID: " + (facility.hefamaaId || "Not visible") + ".",
        "Status: " + (facility.registrationStatus || facility.normalizedStatus || "Not visible") + ".",
        "Latest visible year: " + (facility.renewalYear ?? "Unknown") + ".",
        detailsMissing ? "Detailed address/LGA/staff fields are not cached yet; run detail enrichment for full offline answers." : "",
      ].filter(Boolean).join(" "),
      record: facility,
    };
  }

  if (/mushin|lga|local government/i.test(question)) {
    const lgaMatch = question.match(/(?:in|for|under)\s+([a-z\s-]+)(?:\s+local government|\s+lga)?/i);
    const lga = lgaMatch?.[1]?.trim() ?? "";
    const filtered = filterPortalFacilityRecords({ lga });
    return {
      question,
      answer: filtered.totalMatches
        ? filtered.totalMatches + " portal records matched LGA " + normalizeLGA(lga) + "."
        : "No LGA matches are available in the current list scan cache. LGA-based portal export will work after detail enrichment captures LGA/address fields from facility record pages.",
      rows: filtered.records.slice(0, 50),
    };
  }

  return {
    question,
    answer: "The latest portal scan is available offline: " + summary.totalPortalRecords + " indexed rows, " + summary.totalFacilities + " distinct facilities, " + summary.facilityTypeCounts.new_registration + " new registrations, and " + summary.facilityTypeCounts.existing_facility + " existing facilities.",
  };
}
