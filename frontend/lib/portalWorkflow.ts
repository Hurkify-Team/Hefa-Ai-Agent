import { readPortalCacheRows, type PortalCacheRow } from "@/lib/portalCacheModel";

export const PORTAL_WORKFLOW_STATUSES = [
  "DOCUMENT_QUERY",
  "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING",
  "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING",
  "DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING",
  "INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING",
  "FINAL_APPROVAL_PENDING",
] as const;

export type PortalWorkflowStatus = (typeof PORTAL_WORKFLOW_STATUSES)[number];

export const PORTAL_WORKFLOW_LABELS: Record<PortalWorkflowStatus, string> = {
  DOCUMENT_QUERY: "Document Query",
  UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: "Upload Payment/Document Approval Pending",
  PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: "Payment Approved/Document Approval Pending",
  DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING: "Document Approved/Inspection Report Pending",
  INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING: "Inspection Report Upload/Inspection Approval Pending",
  FINAL_APPROVAL_PENDING: "Final Approval Pending",
};

export type PortalWorkflowFacility = {
  id: string;
  facilityName: string | null;
  facilityCode: string | null;
  category: string | null;
  lga: string | null;
  currentWorkflowStatus: PortalWorkflowStatus;
  currentWorkflowStatusLabel: string;
  lastActivityDate: string | null;
  lastScanDate: string | null;
  rawStatus: string;
};

type WorkflowSummary = {
  totalPortalRecords: number;
  statusCounts: Record<PortalWorkflowStatus, number>;
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
    currentWorkflowStatus,
    currentWorkflowStatusLabel: PORTAL_WORKFLOW_LABELS[currentWorkflowStatus],
    lastActivityDate: latestDate(row.updated_at, row.captured_at),
    lastScanDate: latestDate(row.captured_at, row.updated_at),
    rawStatus: primaryPortalStatusText(row),
  };
}

export function buildPortalWorkflowSummary(rows: PortalCacheRow[] = readPortalCacheRows()): WorkflowSummary {
  const statusCounts = emptyPortalWorkflowCounts();
  const facilities: PortalWorkflowFacility[] = [];

  for (const row of rows) {
    const facility = portalWorkflowFacilityFromRow(row);
    if (!facility) continue;
    statusCounts[facility.currentWorkflowStatus] += 1;
    facilities.push(facility);
  }

  return {
    totalPortalRecords: rows.length,
    statusCounts,
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

  for (const row of rows) {
    const rawStatus = primaryPortalStatusText(row) || "UNKNOWN";
    rawStatusCounts.set(rawStatus, (rawStatusCounts.get(rawStatus) ?? 0) + 1);
    const normalized = normalizePortalWorkflowStatus(rawPortalStatusText(row));
    normalizedStatusMapping[rawStatus] = normalized;

    const facility = portalWorkflowFacilityFromRow(row);
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
    facilitiesWithUnknownStatus: rows.filter((row) => normalizePortalWorkflowStatus(rawPortalStatusText(row)) === "UNKNOWN").length,
    sampleFacilities,
    unknownFacilities,
  };
}
