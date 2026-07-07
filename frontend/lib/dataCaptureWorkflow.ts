import { logAuditEntry } from "@/lib/auditLog";
import { checkDuplicateFacility } from "@/lib/duplicateChecker";
import { addNewFacilityRow, readExistingRecords, readSheetHeaders, readSheetTabs, updateExistingFacilityRow } from "@/lib/googleSheets";
import { mapPortalTextToSheetHeaders } from "@/lib/geminiMapper";
import { normalizeFacilityName, normalizeHeaderName, normalizePhoneNumber } from "@/lib/normalizers";
import { clearWorkbookSourceCache } from "@/lib/workbookSources";
import type { FieldMappingResult } from "@/types/ai";
import type { DuplicateCheckResult } from "@/types/facility";
import type { SheetRow, SheetRowValue, SheetTab } from "@/types/sheet";
import type { PortalFacilityDetailRecord } from "@/lib/playwrightPortal";

export type DataCapturePreview = {
  capturedData: Record<string, unknown>;
  confidence: number;
  duplicate: DuplicateCheckResult | null;
  headers: string[];
  mappedFields: SheetRow;
  missingFields: string[];
  targetSheet: string | null;
  unmappedFields: string[];
  warnings: string[];
};

function normalizeCategoryMatchValue(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(?:category|facility|facilities|centre|center|services?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolvePortalCategory(tabs: SheetTab[], portalCategory?: string | null) {
  const normalizedPortalCategory = portalCategory ? normalizeCategoryMatchValue(portalCategory) : "";

  if (!normalizedPortalCategory) return null;

  return (
    tabs.find((tab) => normalizeCategoryMatchValue(tab.title) === normalizedPortalCategory)?.title ??
    tabs.find((tab) => {
      const normalizedTab = normalizeCategoryMatchValue(tab.title);
      return normalizedTab.includes(normalizedPortalCategory) || normalizedPortalCategory.includes(normalizedTab);
    })?.title ??
    null
  );
}

function flattenValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => flattenValue(entry))
      .filter(Boolean)
      .join("; ");
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => {
        const text = flattenValue(entry);
        return text ? key + ": " + text : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(value);
}

function mergeCapturedFields(detail: PortalFacilityDetailRecord) {
  return {
    ...detail.visibleFields,
    ...detail.fieldIndex,
    "Facility Name": detail.facilityName,
    "HEF/NO": detail.hefamaaId,
    "Facility Code": detail.hefamaaId,
    Category: detail.category,
    Sector: detail.identification?.facilitySector ?? detail.visibleFields["Facility Sector"] ?? "",
    Status: detail.registrationStatus,
    "Registration Status": detail.registrationStatus,
    "Renewal Year": detail.renewalYear == null ? "" : String(detail.renewalYear),
    "Application Type": detail.applicationType,
    "Admission Beds": detail.admissionBeds == null ? "" : String(detail.admissionBeds),
    "Observation Beds": detail.observationBeds == null ? "" : String(detail.observationBeds),
    Couches: detail.couches == null ? "" : String(detail.couches),
    "No of Couches": detail.couches == null ? "" : String(detail.couches),
    "Operating Officer": flattenValue(detail.operatingOfficer),
    "Medical Professional in Charge": flattenValue(detail.operatingOfficer),
    "Professional Staff": flattenValue(detail.professionalStaff),
    "Uploaded Documents": flattenValue(detail.documents),
    Queries: detail.workflow?.queries ?? detail.visibleFields.Queries ?? "",
  };
}

function sheetRowValue(value: unknown): SheetRowValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const text = flattenValue(value).trim();
  return text ? text : null;
}

function valueByAlias(row: SheetRow, aliases: string[]) {
  const normalizedAliases = aliases.map(normalizeHeaderName);
  for (const [header, value] of Object.entries(row)) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const normalizedHeader = normalizeHeaderName(header);
    if (normalizedAliases.includes(normalizedHeader) || normalizedAliases.some((alias) => normalizedHeader.includes(alias))) {
      return String(value).trim();
    }
  }
  return "";
}

function findMatchingRow(values: SheetRow, rows: SheetRow[]) {
  const incomingCode = valueByAlias(values, ["HEF/NO", "HEF NO", "HEFA NO", "HEFAMAA NO", "Facility Code", "Facility ID"]);
  const incomingPortalId = valueByAlias(values, ["Portal ID", "Portal Facility ID", "Application ID"]);
  const incomingName = normalizeFacilityName(valueByAlias(values, ["Facility Name", "Name of Facility", "Name"]));
  const incomingPhone = normalizePhoneNumber(valueByAlias(values, ["Phone", "Phone Number", "Contact", "Telephone"]));

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex];
    const rowCode = valueByAlias(row, ["HEF/NO", "HEF NO", "HEFA NO", "HEFAMAA NO", "Facility Code", "Facility ID"]);
    if (incomingCode && rowCode && incomingCode.toLowerCase() === rowCode.toLowerCase()) return rowIndex;

    const rowPortalId = valueByAlias(row, ["Portal ID", "Portal Facility ID", "Application ID"]);
    if (incomingPortalId && rowPortalId && incomingPortalId.toLowerCase() === rowPortalId.toLowerCase()) return rowIndex;

    const rowName = normalizeFacilityName(valueByAlias(row, ["Facility Name", "Name of Facility", "Name"]));
    if (incomingName && rowName && incomingName === rowName) return rowIndex;

    const rowPhone = normalizePhoneNumber(valueByAlias(row, ["Phone", "Phone Number", "Contact", "Telephone"]));
    if (incomingPhone && rowPhone && incomingPhone === rowPhone) return rowIndex;
  }

  return null;
}

function unmappedCapturedFields(capturedFields: Record<string, unknown>, mapped: SheetRow) {
  const mappedValues = new Set(
    Object.values(mapped)
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean),
  );

  return Object.entries(capturedFields)
    .filter(([, value]) => {
      const text = flattenValue(value).trim().toLowerCase();
      return text && !mappedValues.has(text);
    })
    .map(([field]) => field)
    .slice(0, 80);
}

export async function buildDataCapturePreview(detail: PortalFacilityDetailRecord): Promise<DataCapturePreview> {
  const tabs = await readSheetTabs();
  const targetSheet = resolvePortalCategory(tabs, detail.category);
  const warnings = [...(detail.captureWarnings ?? [])];
  const capturedFields = mergeCapturedFields(detail);

  if (!targetSheet) {
    warnings.push("Category sheet not found for portal category: " + (detail.category || "Unknown"));
    return {
      capturedData: { ...detail, capturedFields },
      confidence: 0,
      duplicate: null,
      headers: [],
      mappedFields: {},
      missingFields: [],
      targetSheet: null,
      unmappedFields: Object.keys(capturedFields),
      warnings,
    };
  }

  const existing = await readExistingRecords(targetSheet);
  const portalText = [detail.text, Object.entries(capturedFields).map(([key, value]) => key + ": " + flattenValue(value)).join("\n")].filter(Boolean).join("\n");
  const mapped: FieldMappingResult = await mapPortalTextToSheetHeaders({
    category: existing.category,
    headers: existing.headers,
    sampleRows: existing.rows.slice(0, 10),
    portalText,
  });
  const enrichedFields: SheetRow = { ...mapped.matchedFields };

  for (const header of existing.headers) {
    if (enrichedFields[header] !== null && enrichedFields[header] !== undefined && String(enrichedFields[header]).trim() !== "") continue;
    const normalizedHeader = normalizeHeaderName(header);
    const directEntry = Object.entries(capturedFields).find(([field]) => {
      const normalizedField = normalizeHeaderName(field);
      return normalizedField === normalizedHeader || normalizedField.includes(normalizedHeader) || normalizedHeader.includes(normalizedField);
    });
    if (directEntry) enrichedFields[header] = sheetRowValue(directEntry[1]);
  }

  const missingFields = existing.headers.filter((header) => {
    const value = enrichedFields[header];
    return value === null || value === undefined || String(value).trim() === "";
  });
  const duplicate = checkDuplicateFacility(enrichedFields, existing.rows);

  return {
    capturedData: { ...detail, capturedFields, mappedFields: enrichedFields, targetSheet: existing.category },
    confidence: existing.headers.length ? Math.max(mapped.confidence, (existing.headers.length - missingFields.length) / existing.headers.length) : mapped.confidence,
    duplicate,
    headers: existing.headers,
    mappedFields: enrichedFields,
    missingFields,
    targetSheet: existing.category,
    unmappedFields: unmappedCapturedFields(capturedFields, enrichedFields),
    warnings,
  };
}

export async function saveCapturedDataToSheet(input: {
  capturedData: Record<string, unknown>;
  mode?: "insert_or_update";
  targetSheet?: string | null;
  user?: string;
}) {
  const targetSheet = input.targetSheet || String(input.capturedData.targetSheet ?? input.capturedData.category ?? "").trim();
  if (!targetSheet) throw new Error("Target sheet is required before saving.");

  const existing = await readExistingRecords(targetSheet);
  const rawMapped = (input.capturedData.mappedFields ?? input.capturedData.matchedFields ?? input.capturedData.values ?? {}) as Record<string, unknown>;
  const values: SheetRow = {};

  for (const header of existing.headers) {
    values[header] = sheetRowValue(rawMapped[header]);
  }

  const existingRowIndex = findMatchingRow(values, existing.rows);
  const confidence = typeof input.capturedData.confidence === "number" ? input.capturedData.confidence : undefined;
  const sourcePortalUrl = typeof input.capturedData.url === "string" ? input.capturedData.url : undefined;
  const facilityName = valueByAlias(values, ["Facility Name", "Name of Facility", "Name"]);

  if (existingRowIndex !== null) {
    const filledFields = Object.keys(values).filter((field) => values[field] !== null && values[field] !== undefined && String(values[field]).trim() !== "");
    const result = await updateExistingFacilityRow(targetSheet, existingRowIndex, values, filledFields);
    clearWorkbookSourceCache("active");
    await logAuditEntry({
      user: input.user ?? "Admin User",
      actionType: "update",
      category: result.category,
      facilityName,
      affectedRow: result.rowIndex,
      confidenceScore: confidence,
      sourcePortalUrl,
      status: "success",
      details: "Data Capture insert_or_update updated an existing facility row.",
    });
    return {
      success: true,
      sheet: result.category,
      rowNumber: result.rowIndex + 2,
      action: "updated" as const,
      mappedFields: Object.keys(values).filter((field) => values[field] !== null && values[field] !== undefined && String(values[field]).trim() !== ""),
      unmappedFields: existing.headers.filter((field) => values[field] === null || values[field] === undefined || String(values[field]).trim() === ""),
    };
  }

  const result = await addNewFacilityRow(targetSheet, values);
  clearWorkbookSourceCache("active");
  await logAuditEntry({
    user: input.user ?? "Admin User",
    actionType: "add",
    category: result.category,
    facilityName,
    affectedRow: result.rowIndex,
    confidenceScore: confidence,
    sourcePortalUrl,
    status: "success",
    details: "Data Capture insert_or_update inserted a new facility row.",
  });

  return {
    success: true,
    sheet: result.category,
    rowNumber: result.rowIndex + 2,
    action: "inserted" as const,
    mappedFields: Object.keys(values).filter((field) => values[field] !== null && values[field] !== undefined && String(values[field]).trim() !== ""),
    unmappedFields: existing.headers.filter((field) => values[field] === null || values[field] === undefined || String(values[field]).trim() === ""),
  };
}
