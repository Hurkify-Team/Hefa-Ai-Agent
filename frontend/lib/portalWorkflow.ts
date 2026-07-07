import { readPortalCacheRows, type PortalCacheRow } from "@/lib/portalCacheModel";

export const PORTAL_WORKFLOW_STATUSES = [
  "DOCUMENT_QUERY",
  "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING",
  "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING",
  "DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING",
  "INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING",
  "FINAL_APPROVAL_PENDING",
  "REGISTRATION_APPROVED",
] as const;

export type PortalWorkflowStatus = (typeof PORTAL_WORKFLOW_STATUSES)[number];
export type PortalFacilitySector = "PUBLIC" | "PRIVATE" | "UNKNOWN";

export const PORTAL_WORKFLOW_LABELS: Record<PortalWorkflowStatus, string> = {
  DOCUMENT_QUERY: "Document Query",
  UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: "Upload Payment/Document Approval Pending",
  PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: "Payment Approved/Document Approval Pending",
  DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING: "Document Approved/Inspection Report Pending",
  INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING: "Inspection Report Upload/Inspection Approval Pending",
  FINAL_APPROVAL_PENDING: "Final Approval Pending",
  REGISTRATION_APPROVED: "Registration Approved",
};

export type PortalWorkflowFacility = {
  id: string;
  facilityName: string | null;
  facilityCode: string | null;
  category: string | null;
  lga: string | null;
  sector: PortalFacilitySector;
  currentWorkflowStatus: PortalWorkflowStatus;
  currentWorkflowStatusLabel: string;
  lastActivityDate: string | null;
  lastScanDate: string | null;
  rawStatus: string;
  registrationApprovedAt: string | null;
  approvalMonth: string | null;
  approvalYear: string | null;
  approvalDateSource: string | null;
  approvalDateWarning: string | null;
};

type WorkflowSummary = {
  totalPortalRecords: number;
  statusCounts: Record<PortalWorkflowStatus, number>;
  sectorCounts: Record<PortalFacilitySector, number>;
  lastScan: string | null;
  source: "portal_cache";
  facilities: PortalWorkflowFacility[];
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function normalizePortalFacilitySector(value: unknown): PortalFacilitySector {
  const text = normalize(value);
  if (!text) return "UNKNOWN";
  if (/\b(public|government|govt)\b/.test(text) || /government owned|public sector/.test(text)) return "PUBLIC";
  if (/\b(private|privately)\b/.test(text) || /private owned|privately owned|private sector/.test(text)) return "PRIVATE";
  return "UNKNOWN";
}

function emptySectorCounts(): Record<PortalFacilitySector, number> {
  return { PUBLIC: 0, PRIVATE: 0, UNKNOWN: 0 };
}

function latestDate(...values: Array<string | null | undefined>) {
  return values
    .map((value) => clean(value))
    .filter(Boolean)
    .sort((first, second) => (Date.parse(second) || 0) - (Date.parse(first) || 0))[0] ?? null;
}

function visibleFieldText(row: PortalCacheRow) {
  const data = row.structured_portal_data ?? {};
  const visibleFields = typeof data === "object" && data && "visibleFields" in data ? data.visibleFields : null;
  const fieldIndex = typeof data === "object" && data && "fieldIndex" in data ? data.fieldIndex : null;
  return [visibleFields, fieldIndex]
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value))
    .flatMap((value) => Object.entries(value).map(([key, fieldValue]) => key + " " + clean(fieldValue)))
    .join(" ");
}

export function primaryPortalStatusText(row: PortalCacheRow) {
  return clean(row.registration_status) || clean(row.requirements_status) || clean(row.inspection_status) || clean(row.accreditation_status) || "UNKNOWN";
}

export function rawPortalStatusText(row: PortalCacheRow) {
  return clean([
    primaryPortalStatusText(row),
    row.requirements_status,
    row.inspection_status,
    row.accreditation_status,
    visibleFieldText(row),
    row.raw_portal_text,
  ].filter(Boolean).join(" "));
}

export function normalizePortalWorkflowStatus(value: unknown): PortalWorkflowStatus | "UNKNOWN" {
  const text = normalize(value);
  if (!text) return "UNKNOWN";

  if (/documents?\s+(query|queried)|queried\s+documents?|query\s+documents?|documents?\s+is\s+queried/.test(text)) {
    return "DOCUMENT_QUERY";
  }

  if (/inspection\s+report\s+upload.*(pending|approval)|inspection\s+approval\s+pending|inspection\s+report.*pending\s+approval/.test(text)) {
    return "INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING";
  }

  if (/documents?\s+approved.*inspection.*(report|reporting).*pending|inspection\s+reporting\s+pending|documents?\s+approved\s+inspection\s+report\s+pending/.test(text)) {
    return "DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING";
  }

  if (/payment\s+approved.*document\s+approval\s+pending|payment\s+approved.*pending\s+document|document\s+approval\s+pending.*payment\s+approved/.test(text)) {
    return "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING";
  }

  if (/upload\s+payment.*document\s+approval\s+pending|upload\s+payment.*pending\s+document|pending\s+document\s+approval.*upload\s+payment/.test(text)) {
    return "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING";
  }

  if (/final\s+approval\s+pending|awaiting\s+final\s+approval/.test(text)) {
    return "FINAL_APPROVAL_PENDING";
  }

  if (/registration\s+approved|approved\s+registration|license\s+(issued|ready|approved)|licence\s+(issued|ready|approved)|provisional\s+licen[cs]e/.test(text) || text === "approved") {
    return "REGISTRATION_APPROVED";
  }

  return "UNKNOWN";
}

export function emptyPortalWorkflowCounts() {
  return Object.fromEntries(PORTAL_WORKFLOW_STATUSES.map((status) => [status, 0])) as Record<PortalWorkflowStatus, number>;
}

export function portalWorkflowFacilityFromRow(row: PortalCacheRow): PortalWorkflowFacility | null {
  const rawStatus = rawPortalStatusText(row);
  const currentWorkflowStatus = normalizePortalWorkflowStatus(rawStatus);
  if (currentWorkflowStatus === "UNKNOWN") return null;

  return {
    id: row.id,
    facilityName: row.facility_name,
    facilityCode: row.hef_no,
    category: row.category,
    lga: row.lga,
    sector: normalizePortalFacilitySector(row.sector),
    currentWorkflowStatus,
    currentWorkflowStatusLabel: PORTAL_WORKFLOW_LABELS[currentWorkflowStatus],
    lastActivityDate: latestDate(row.updated_at, row.captured_at),
    lastScanDate: latestDate(row.captured_at, row.updated_at),
    rawStatus: primaryPortalStatusText(row),
    registrationApprovedAt: row.registrationApprovedAt,
    approvalMonth: row.approvalMonth,
    approvalYear: row.approvalYear,
    approvalDateSource: row.approvalDateSource,
    approvalDateWarning: row.approvalDateWarning,
  };
}

export function buildPortalWorkflowSummary(rows: PortalCacheRow[] = readPortalCacheRows()): WorkflowSummary {
  const statusCounts = emptyPortalWorkflowCounts();
  const sectorCounts = emptySectorCounts();
  const facilities: PortalWorkflowFacility[] = [];

  for (const row of rows) {
    const facility = portalWorkflowFacilityFromRow(row);
    if (!facility) continue;
    statusCounts[facility.currentWorkflowStatus] += 1;
    sectorCounts[facility.sector] += 1;
    facilities.push(facility);
  }

  return {
    totalPortalRecords: rows.length,
    statusCounts,
    sectorCounts,
    lastScan: latestDate(...rows.map((row) => row.captured_at ?? row.updated_at)),
    source: "portal_cache",
    facilities,
  };
}

export function buildPortalWorkflowDiagnostics(rows: PortalCacheRow[] = readPortalCacheRows()) {
  const rawStatusCounts = new Map<string, number>();
  const normalizedStatusMapping: Record<string, PortalWorkflowStatus | "UNKNOWN"> = {};
  const sampleFacilities = PORTAL_WORKFLOW_STATUSES.reduce((acc, status) => {
    acc[status] = [];
    return acc;
  }, {} as Record<PortalWorkflowStatus, PortalWorkflowFacility[]>);
  const unknownFacilities: Array<{ facilityName: string | null; facilityCode: string | null; rawStatus: string }> = [];
  const sectorCounts = emptySectorCounts();

  for (const row of rows) {
    const rawStatus = primaryPortalStatusText(row) || "UNKNOWN";
    rawStatusCounts.set(rawStatus, (rawStatusCounts.get(rawStatus) ?? 0) + 1);
    const normalized = normalizePortalWorkflowStatus(rawPortalStatusText(row));
    normalizedStatusMapping[rawStatus] = normalized;

    const facility = portalWorkflowFacilityFromRow(row);
    sectorCounts[normalizePortalFacilitySector(row.sector)] += 1;
    if (facility) {
      if (sampleFacilities[facility.currentWorkflowStatus].length < 5) {
        sampleFacilities[facility.currentWorkflowStatus].push(facility);
      }
    } else if (unknownFacilities.length < 20) {
      unknownFacilities.push({ facilityName: row.facility_name, facilityCode: row.hef_no, rawStatus });
    }
  }

  return {
    rawPortalStatusesFound: Array.from(rawStatusCounts.entries()).map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count).slice(0, 200),
    normalizedStatusMapping,
    totalFacilitiesCounted: rows.length,
    sectorCounts,
    facilitiesWithUnknownStatus: rows.filter((row) => normalizePortalWorkflowStatus(rawPortalStatusText(row)) === "UNKNOWN").length,
    sampleFacilities,
    unknownFacilities,
  };
}


function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function yearKey(date = new Date()) {
  return date.toISOString().slice(0, 4);
}

function addMonths(date: Date, delta: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + delta, 1));
}

function addYears(date: Date, delta: number) {
  return new Date(Date.UTC(date.getUTCFullYear() + delta, 0, 1));
}

function approvalFacilityRow(facility: PortalWorkflowFacility) {
  return {
    id: facility.id,
    facilityName: facility.facilityName,
    facilityCode: facility.facilityCode,
    category: facility.category,
    lga: facility.lga,
    approvalDate: facility.registrationApprovedAt,
    approvalMonth: facility.approvalMonth,
    approvalYear: facility.approvalYear,
    approvalDateSource: facility.approvalDateSource,
    approvalDateWarning: facility.approvalDateWarning,
    portalStatus: facility.currentWorkflowStatusLabel,
    lastScanDate: facility.lastScanDate,
  };
}

export function buildRegistrationApprovedAnalytics(input: { endDate?: string | null; month?: string | null; startDate?: string | null; year?: string | null } = {}) {
  const workflow = buildPortalWorkflowSummary();
  const approvedFacilities = workflow.facilities.filter((facility) => facility.currentWorkflowStatus === "REGISTRATION_APPROVED");
  const datedFacilities = approvedFacilities.filter((facility) => facility.registrationApprovedAt && facility.approvalMonth && facility.approvalYear);
  const now = new Date();
  const thisMonth = monthKey(now);
  const lastMonth = monthKey(addMonths(now, -1));
  const thisYear = yearKey(now);
  const lastYear = yearKey(addYears(now, -1));

  const monthlyCounts = new Map<string, number>();
  const yearlyCounts = new Map<string, number>();
  for (const facility of datedFacilities) {
    monthlyCounts.set(facility.approvalMonth!, (monthlyCounts.get(facility.approvalMonth!) ?? 0) + 1);
    yearlyCounts.set(facility.approvalYear!, (yearlyCounts.get(facility.approvalYear!) ?? 0) + 1);
  }

  const startTime = input.startDate ? Date.parse(input.startDate) : null;
  const endTime = input.endDate ? Date.parse(input.endDate) : null;
  const selectedFacilities = datedFacilities.filter((facility) => {
    if (input.month && facility.approvalMonth !== input.month) return false;
    if (input.year && facility.approvalYear !== input.year) return false;
    const time = facility.registrationApprovedAt ? Date.parse(facility.registrationApprovedAt) : NaN;
    if (startTime && Number.isFinite(time) && time < startTime) return false;
    if (endTime && Number.isFinite(time) && time > endTime) return false;
    return true;
  });

  const thisYearFacilities = datedFacilities.filter((facility) => facility.approvalYear === thisYear);
  const lgaCountsThisYear = Array.from(thisYearFacilities.reduce((map, facility) => {
    const lga = clean(facility.lga) || "Unknown LGA";
    map.set(lga, (map.get(lga) ?? 0) + 1);
    return map;
  }, new Map<string, number>()).entries()).map(([lga, count]) => ({ lga, count })).sort((a, b) => b.count - a.count);

  return {
    success: true,
    totalApproved: approvedFacilities.length,
    approvedThisMonth: monthlyCounts.get(thisMonth) ?? 0,
    approvedLastMonth: monthlyCounts.get(lastMonth) ?? 0,
    approvedThisYear: yearlyCounts.get(thisYear) ?? 0,
    approvedLastYear: yearlyCounts.get(lastYear) ?? 0,
    approvedWithoutDate: approvedFacilities.length - datedFacilities.length,
    monthly: Array.from(monthlyCounts.entries()).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
    yearly: Array.from(yearlyCounts.entries()).map(([year, count]) => ({ year, count })).sort((a, b) => a.year.localeCompare(b.year)),
    lgaCountsThisYear,
    facilities: selectedFacilities.slice(0, 500).map(approvalFacilityRow),
    filters: {
      endDate: input.endDate ?? null,
      month: input.month ?? null,
      startDate: input.startDate ?? null,
      year: input.year ?? null,
    },
    source: "portal_cache" as const,
    lastScan: workflow.lastScan,
  };
}


const APPROVAL_MONTH_NAMES: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

function approvalQuestionYear(question: string) {
  if (/last\s+year/i.test(question)) return yearKey(addYears(new Date(), -1));
  if (/this\s+year|current\s+year/i.test(question)) return yearKey(new Date());
  return question.match(/\b(20\d{2}|19\d{2})\b/)?.[1] ?? null;
}

function approvalQuestionMonth(question: string) {
  if (/last\s+month/i.test(question)) return monthKey(addMonths(new Date(), -1));
  if (/this\s+month|current\s+month/i.test(question)) return monthKey(new Date());
  const lower = question.toLowerCase();
  const monthName = Object.keys(APPROVAL_MONTH_NAMES).find((name) => lower.includes(name));
  if (!monthName) return null;
  const year = approvalQuestionYear(question) ?? yearKey(new Date());
  return year + "-" + APPROVAL_MONTH_NAMES[monthName];
}

export function isRegistrationApprovedAnalyticsQuestion(question: string) {
  return /registration\s+approv|approved\s+facilit|facilities\s+approved|approval\s+trend|monthly\s+registration\s+approv|yearly\s+registration\s+approv|approved\s+in\s+\d{4}|highest\s+registration\s+approv/i.test(question)
    && /month|year|trend|compare|highest|\b20\d{2}\b|january|february|march|april|may|june|july|august|september|october|november|december/i.test(question);
}

export function answerRegistrationApprovedAnalyticsQuestion(question: string, requiresList = false) {
  const month = approvalQuestionMonth(question);
  const year = !month ? approvalQuestionYear(question) : null;
  const analytics = buildRegistrationApprovedAnalytics({ month, year });
  const wantsList = requiresList || /show|list|which|display|facilities/i.test(question);

  if (/highest/i.test(question) && /lga|local government/i.test(question)) {
    const top = analytics.lgaCountsThisYear[0];
    return {
      answer: top
        ? top.lga + " has the highest registration approvals this year with " + top.count.toLocaleString() + " approved facilities."
        : "No dated registration approved records are available for the current year in the portal cache.",
      rows: analytics.lgaCountsThisYear.slice(0, 20).map((row) => ({ LGA: row.lga, Count: row.count })),
      summary: { source: analytics.source, lastScan: analytics.lastScan, approvedWithoutDate: analytics.approvedWithoutDate },
    };
  }

  if (/yearly|by\s+year|trend\s+by\s+year|approval\s+trend.*year/i.test(question)) {
    return {
      answer: "I grouped registration approved facilities by approval year from the portal cache. " + analytics.approvedWithoutDate.toLocaleString() + " approved records do not yet have a captured approval date.",
      rows: analytics.yearly.map((row) => ({ Year: row.year, Count: row.count })),
      summary: { source: analytics.source, lastScan: analytics.lastScan, approvedWithoutDate: analytics.approvedWithoutDate },
    };
  }

  if (/monthly|by\s+month|trend|compare/i.test(question) && !month && !year) {
    return {
      answer: "I grouped registration approved facilities by approval month from the portal cache. " + analytics.approvedWithoutDate.toLocaleString() + " approved records do not yet have a captured approval date.",
      rows: analytics.monthly.slice(-24).map((row) => ({ Month: row.month, Count: row.count })),
      summary: { source: analytics.source, lastScan: analytics.lastScan, approvedWithoutDate: analytics.approvedWithoutDate },
    };
  }

  if (month) {
    return {
      answer: analytics.facilities.length.toLocaleString() + " facilities were registration approved in " + month + " based on captured portal approval dates. " + analytics.approvedWithoutDate.toLocaleString() + " approved records do not yet have a captured approval date.",
      rows: wantsList ? analytics.facilities.map((facility) => ({
        "Facility Name": facility.facilityName,
        "HEFA NO / Facility Code": facility.facilityCode,
        Category: facility.category,
        LGA: facility.lga,
        "Approval Date": facility.approvalDate,
        "Portal Status": facility.portalStatus,
        "Last Scan Date": facility.lastScanDate,
      })) : [{ Month: month, Count: analytics.facilities.length }],
      summary: { month, source: analytics.source, lastScan: analytics.lastScan, approvedWithoutDate: analytics.approvedWithoutDate },
    };
  }

  if (year) {
    return {
      answer: analytics.facilities.length.toLocaleString() + " facilities were registration approved in " + year + " based on captured portal approval dates. " + analytics.approvedWithoutDate.toLocaleString() + " approved records do not yet have a captured approval date.",
      rows: wantsList ? analytics.facilities.map((facility) => ({
        "Facility Name": facility.facilityName,
        "HEFA NO / Facility Code": facility.facilityCode,
        Category: facility.category,
        LGA: facility.lga,
        "Approval Date": facility.approvalDate,
        "Portal Status": facility.portalStatus,
        "Last Scan Date": facility.lastScanDate,
      })) : [{ Year: year, Count: analytics.facilities.length }],
      summary: { year, source: analytics.source, lastScan: analytics.lastScan, approvedWithoutDate: analytics.approvedWithoutDate },
    };
  }

  return {
    answer: analytics.totalApproved.toLocaleString() + " facilities are registration approved in the portal cache. " + analytics.approvedWithoutDate.toLocaleString() + " approved records do not yet have a captured approval date.",
    rows: [
      { Metric: "Total Registration Approved", Count: analytics.totalApproved },
      { Metric: "Approved This Month", Count: analytics.approvedThisMonth },
      { Metric: "Approved This Year", Count: analytics.approvedThisYear },
      { Metric: "Approved Without Captured Approval Date", Count: analytics.approvedWithoutDate },
    ],
    summary: { source: analytics.source, lastScan: analytics.lastScan, approvedWithoutDate: analytics.approvedWithoutDate },
  };
}
