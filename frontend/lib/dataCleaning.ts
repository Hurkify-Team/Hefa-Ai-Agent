import type { SheetRow, SheetRowValue } from "@/types/sheet";
import { getAllSheetData, updateSheetCells, type SheetCellUpdate } from "@/lib/googleSheets";
import { normalizeEmail, normalizeFacilityName, normalizeHeaderName, normalizePhoneNumber } from "@/lib/normalizers";

export type SerialNumberIssue = {
  category: string;
  serialHeader: string;
  rowIndex: number;
  sheetRowNumber: number;
  currentValue: SheetRowValue;
  expectedValue: number | null;
  reason: "renumber" | "clear_empty_row_serial";
};

export type SerialNumberCategorySummary = {
  category: string;
  serialHeader: string | null;
  rowCount: number;
  nonEmptyRows: number;
  issueCount: number;
  skippedReason?: string;
};

export type SerialNumberAnalysis = {
  scope: string;
  totalCategories: number;
  categoriesWithSerial: number;
  totalRows: number;
  issueCount: number;
  categories: SerialNumberCategorySummary[];
  issues: SerialNumberIssue[];
};

export type ApplySerialNumberFixResult = SerialNumberAnalysis & {
  applied: boolean;
  updatedCells: number;
};

export type PhoneNormalizationIssue = {
  category: string;
  contactHeader: string;
  rowIndex: number;
  sheetRowNumber: number;
  facilityName: string;
  currentValue: string;
  normalizedValue: string;
  reason: "digits_only" | "local_prefix" | "country_code" | "multiple_numbers";
};

export type PhoneNormalizationCategorySummary = {
  category: string;
  contactHeader: string | null;
  rowCount: number;
  issueCount: number;
  skippedReason?: string;
};

export type PhoneNormalizationAnalysis = {
  scope: string;
  totalCategories: number;
  totalRows: number;
  issueCount: number;
  categories: PhoneNormalizationCategorySummary[];
  issues: PhoneNormalizationIssue[];
};

export type ApplyPhoneNormalizationFixResult = PhoneNormalizationAnalysis & {
  applied: boolean;
  updatedCells: number;
};


export type DataQualityIssueType =
  | "missing_required_field"
  | "invalid_phone"
  | "invalid_email"
  | "duplicate_identity";

export type DataQualityIssue = {
  type: DataQualityIssueType;
  category: string;
  rowIndex: number;
  sheetRowNumber: number;
  field: string;
  value: SheetRowValue;
  message: string;
  severity: "warning" | "critical";
  relatedRows?: Array<{
    category: string;
    rowIndex: number;
    sheetRowNumber: number;
    facilityName: string;
    field: string;
    value: string;
  }>;
};

export type DataQualityCategorySummary = {
  category: string;
  rowCount: number;
  missingRequiredFields: number;
  invalidPhones: number;
  invalidEmails: number;
  duplicateWarnings: number;
  issueCount: number;
};

export type DataQualityAnalysis = {
  scope: string;
  totalCategories: number;
  totalRows: number;
  issueCount: number;
  missingRequiredFields: number;
  invalidPhones: number;
  invalidEmails: number;
  duplicateWarnings: number;
  categories: DataQualityCategorySummary[];
  issues: DataQualityIssue[];
};


const SERIAL_HEADER_KEYS = new Set([
  "sn",
  "sno",
  "serialno",
  "serialnumber",
  "snumber",
  "number",
]);

function compactHeader(header: string) {
  return normalizeHeaderName(header).replace(/[^a-z0-9]+/g, "");
}

function serialHeaderFor(headers: string[]) {
  return headers.find((header) => SERIAL_HEADER_KEYS.has(compactHeader(header))) ?? null;
}

function isFilled(value: SheetRowValue | undefined) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function rowHasData(row: SheetRow, serialHeader: string) {
  return Object.entries(row).some(([header, value]) => header !== serialHeader && isFilled(value));
}



const REQUIRED_FIELD_ALIASES = [
  ["Facility Name", ["Facility Name", "FACILITY NAME", "Name"]],
  ["Address", ["Address", "ADDRESS", "Facility Address"]],
  ["LGA", ["LGA", "Local Government"]],
  ["Contact", ["Contact", "Phone", "Phone Number", "Phone No", "PHONE NO", "Telephone"]],
] as const;

const DATA_QUALITY_FIELD_ALIASES = {
  hefNo: ["HEF/NO", "HEF NO", "REG NO", "Registration Number"],
  facilityName: ["Facility Name", "FACILITY NAME", "Name"],
  address: ["Address", "ADDRESS", "Facility Address"],
  contact: ["Contact", "Phone", "Phone Number", "Phone No", "PHONE NO", "Telephone"],
  email: ["Facility E-Mail", "Facility Email", "Email", "E-Mail", "E-MAIL"],
};

type RowIdentity = {
  category: string;
  rowIndex: number;
  sheetRowNumber: number;
  facilityName: string;
  field: string;
  value: string;
};

function findHeader(headers: string[], aliases: readonly string[]) {
  const normalizedHeaders = new Map(headers.map((header) => [normalizeHeaderName(header), header] as const));

  for (const alias of aliases) {
    const header = normalizedHeaders.get(normalizeHeaderName(alias));
    if (header) return header;
  }

  return "";
}

function valueForHeader(row: SheetRow, header: string) {
  if (!header) return "";
  const value = row[header];
  return value === null || value === undefined ? "" : String(value).trim();
}

function isValidEmail(value: string) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function hasValidPhoneToken(value: string) {
  if (!value) return true;
  const tokens = value.match(/\+?\d[\d\s().-]{5,}\d/g) ?? [];

  if (!tokens.length) return false;

  return tokens.some((token) => {
    const normalized = normalizePhoneNumber(token);
    return normalized.length >= 7 && normalized.length <= 15;
  });
}

function isUsableTextIdentity(value: string) {
  const key = value.trim().toLowerCase();
  return key.length > 3 && !/^(n\/?a|nil|none|not available|not applicable|-+)$/.test(key);
}

function addIdentity(map: Map<string, RowIdentity[]>, key: string, identity: RowIdentity) {
  if (!isUsableTextIdentity(key)) return;
  const entries = map.get(key) ?? [];
  entries.push(identity);
  map.set(key, entries);
}

function duplicateGroups(identityMap: Map<string, RowIdentity[]>) {
  return [...identityMap.values()].filter((group) => group.length > 1);
}

function issueKey(issue: Pick<DataQualityIssue, "type" | "category" | "rowIndex" | "field" | "value">) {
  return [issue.type, issue.category, issue.rowIndex, issue.field, String(issue.value ?? "")].join("|");
}



type NormalizedContactValue = {
  value: string;
  reason: PhoneNormalizationIssue["reason"];
};

function phoneReason(originalValue: string, normalizedValue: string): PhoneNormalizationIssue["reason"] {
  const digits = originalValue.replace(/\D/g, "");

  if (/[\n,;/&]+/.test(originalValue)) return "multiple_numbers";
  if (digits.startsWith("234") && normalizedValue.startsWith("0")) return "country_code";
  if (digits.length === 10 && normalizedValue.length === 11 && normalizedValue.startsWith("0")) return "local_prefix";
  return "digits_only";
}

function normalizeSingleContact(value: string) {
  const normalized = normalizePhoneNumber(value);
  return normalized.length >= 7 && normalized.length <= 15 ? normalized : "";
}

function normalizeContactCell(value: string): NormalizedContactValue | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const splitParts = trimmed
    .split(/[\n,;/&]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (splitParts.length > 1) {
    const normalizedParts = splitParts.map(normalizeSingleContact);
    if (normalizedParts.some((part) => !part)) return null;

    const nextValue = [...new Set(normalizedParts)].join(" / ");
    return nextValue && nextValue !== trimmed ? { value: nextValue, reason: "multiple_numbers" } : null;
  }

  const normalizedValue = normalizeSingleContact(trimmed);
  if (!normalizedValue || normalizedValue === trimmed) return null;

  return {
    value: normalizedValue,
    reason: phoneReason(trimmed, normalizedValue),
  };
}

function valuesMatch(currentValue: SheetRowValue, expectedValue: number | null) {
  if (expectedValue === null) {
    return !isFilled(currentValue);
  }

  return String(currentValue ?? "").trim() === String(expectedValue);
}

export async function analyzeSerialNumbering(input: { category?: string } = {}): Promise<SerialNumberAnalysis> {
  const sheets = await getAllSheetData();
  const selectedCategories = input.category ? [input.category] : Object.keys(sheets);
  const categories: SerialNumberCategorySummary[] = [];
  const issues: SerialNumberIssue[] = [];
  let totalRows = 0;

  for (const category of selectedCategories) {
    const sheet = sheets[category];

    if (!sheet) {
      categories.push({
        category,
        serialHeader: null,
        rowCount: 0,
        nonEmptyRows: 0,
        issueCount: 0,
        skippedReason: "Category was not found in the workbook.",
      });
      continue;
    }

    const serialHeader = serialHeaderFor(sheet.headers);
    const rowCount = sheet.rows.length;
    totalRows += rowCount;

    if (!serialHeader) {
      categories.push({
        category,
        serialHeader: null,
        rowCount,
        nonEmptyRows: sheet.rows.filter((row) => Object.values(row).some(isFilled)).length,
        issueCount: 0,
        skippedReason: "No S/N column was detected.",
      });
      continue;
    }

    let nextSerial = 1;
    let nonEmptyRows = 0;
    const startingIssueCount = issues.length;

    sheet.rows.forEach((row, rowIndex) => {
      const hasData = rowHasData(row, serialHeader);
      const expectedValue = hasData ? nextSerial : null;
      const currentValue = row[serialHeader] ?? null;

      if (hasData) {
        nonEmptyRows += 1;
        nextSerial += 1;
      }

      if (!valuesMatch(currentValue, expectedValue)) {
        issues.push({
          category,
          serialHeader,
          rowIndex,
          sheetRowNumber: rowIndex + 2,
          currentValue,
          expectedValue,
          reason: hasData ? "renumber" : "clear_empty_row_serial",
        });
      }
    });

    categories.push({
      category,
      serialHeader,
      rowCount,
      nonEmptyRows,
      issueCount: issues.length - startingIssueCount,
    });
  }

  return {
    scope: input.category ?? "all_categories",
    totalCategories: selectedCategories.length,
    categoriesWithSerial: categories.filter((category) => category.serialHeader).length,
    totalRows,
    issueCount: issues.length,
    categories,
    issues,
  };
}

export async function applySerialNumberFixes(input: { category?: string } = {}): Promise<ApplySerialNumberFixResult> {
  const analysis = await analyzeSerialNumbering(input);
  const updates: SheetCellUpdate[] = analysis.issues.map((issue) => ({
    category: issue.category,
    rowIndex: issue.rowIndex,
    field: issue.serialHeader,
    value: issue.expectedValue,
  }));

  const result = await updateSheetCells(updates);

  return {
    ...analysis,
    applied: true,
    updatedCells: result.updatedCells,
  };
}



export async function analyzePhoneNormalization(input: { category?: string } = {}): Promise<PhoneNormalizationAnalysis> {
  const sheets = await getAllSheetData();
  const selectedCategories = input.category ? [input.category] : Object.keys(sheets);
  const categories: PhoneNormalizationCategorySummary[] = [];
  const issues: PhoneNormalizationIssue[] = [];
  let totalRows = 0;

  for (const category of selectedCategories) {
    const sheet = sheets[category];

    if (!sheet) {
      categories.push({
        category,
        contactHeader: null,
        rowCount: 0,
        issueCount: 0,
        skippedReason: "Category was not found in the workbook.",
      });
      continue;
    }

    const contactHeader = findHeader(sheet.headers, DATA_QUALITY_FIELD_ALIASES.contact);
    const facilityNameHeader = findHeader(sheet.headers, DATA_QUALITY_FIELD_ALIASES.facilityName);
    const startingIssueCount = issues.length;
    totalRows += sheet.rows.length;

    if (!contactHeader) {
      categories.push({
        category,
        contactHeader: null,
        rowCount: sheet.rows.length,
        issueCount: 0,
        skippedReason: "No contact/phone column was detected.",
      });
      continue;
    }

    sheet.rows.forEach((row, rowIndex) => {
      const currentValue = valueForHeader(row, contactHeader);
      const normalized = normalizeContactCell(currentValue);

      if (!normalized) return;

      issues.push({
        category,
        contactHeader,
        rowIndex,
        sheetRowNumber: rowIndex + 2,
        facilityName: valueForHeader(row, facilityNameHeader),
        currentValue,
        normalizedValue: normalized.value,
        reason: normalized.reason,
      });
    });

    categories.push({
      category,
      contactHeader,
      rowCount: sheet.rows.length,
      issueCount: issues.length - startingIssueCount,
    });
  }

  return {
    scope: input.category ?? "all_categories",
    totalCategories: selectedCategories.length,
    totalRows,
    issueCount: issues.length,
    categories: categories.sort((a, b) => b.issueCount - a.issueCount || a.category.localeCompare(b.category)),
    issues,
  };
}

export async function applyPhoneNormalizationFixes(input: { category?: string } = {}): Promise<ApplyPhoneNormalizationFixResult> {
  const analysis = await analyzePhoneNormalization(input);
  const updates: SheetCellUpdate[] = analysis.issues.map((issue) => ({
    category: issue.category,
    rowIndex: issue.rowIndex,
    field: issue.contactHeader,
    value: issue.normalizedValue,
  }));

  const result = await updateSheetCells(updates);

  return {
    ...analysis,
    applied: true,
    updatedCells: result.updatedCells,
  };
}

export async function analyzeDataQuality(input: { category?: string } = {}): Promise<DataQualityAnalysis> {
  const sheets = await getAllSheetData();
  const selectedCategories = input.category ? [input.category] : Object.keys(sheets);
  const categories = new Map<string, DataQualityCategorySummary>();
  const issues: DataQualityIssue[] = [];
  const seenIssueKeys = new Set<string>();
  const hefNoIdentities = new Map<string, RowIdentity[]>();
  const emailIdentities = new Map<string, RowIdentity[]>();
  const phoneIdentities = new Map<string, RowIdentity[]>();
  const nameAddressIdentities = new Map<string, RowIdentity[]>();
  let totalRows = 0;

  function summaryFor(category: string, rowCount: number) {
    const existing = categories.get(category);
    if (existing) return existing;

    const summary: DataQualityCategorySummary = {
      category,
      rowCount,
      missingRequiredFields: 0,
      invalidPhones: 0,
      invalidEmails: 0,
      duplicateWarnings: 0,
      issueCount: 0,
    };
    categories.set(category, summary);
    return summary;
  }

  function addIssue(issue: DataQualityIssue) {
    const key = issueKey(issue);
    if (seenIssueKeys.has(key)) return;
    seenIssueKeys.add(key);
    issues.push(issue);

    const summary = categories.get(issue.category);
    if (!summary) return;

    summary.issueCount += 1;
    if (issue.type === "missing_required_field") summary.missingRequiredFields += 1;
    if (issue.type === "invalid_phone") summary.invalidPhones += 1;
    if (issue.type === "invalid_email") summary.invalidEmails += 1;
    if (issue.type === "duplicate_identity") summary.duplicateWarnings += 1;
  }

  for (const category of selectedCategories) {
    const sheet = sheets[category];
    if (!sheet) {
      summaryFor(category, 0);
      continue;
    }

    const summary = summaryFor(category, sheet.rows.length);
    totalRows += sheet.rows.length;

    const headerLookup = {
      hefNo: findHeader(sheet.headers, DATA_QUALITY_FIELD_ALIASES.hefNo),
      facilityName: findHeader(sheet.headers, DATA_QUALITY_FIELD_ALIASES.facilityName),
      address: findHeader(sheet.headers, DATA_QUALITY_FIELD_ALIASES.address),
      contact: findHeader(sheet.headers, DATA_QUALITY_FIELD_ALIASES.contact),
      email: findHeader(sheet.headers, DATA_QUALITY_FIELD_ALIASES.email),
    };

    sheet.rows.forEach((row, rowIndex) => {
      const sheetRowNumber = rowIndex + 2;
      const facilityName = valueForHeader(row, headerLookup.facilityName);
      const address = valueForHeader(row, headerLookup.address);
      const hefNo = valueForHeader(row, headerLookup.hefNo);
      const contact = valueForHeader(row, headerLookup.contact);
      const email = valueForHeader(row, headerLookup.email);
      const hasAnyData = Object.values(row).some((value) => value !== null && value !== undefined && String(value).trim() !== "");

      if (!hasAnyData) return;

      for (const [label, aliases] of REQUIRED_FIELD_ALIASES) {
        const header = findHeader(sheet.headers, aliases);
        const value = valueForHeader(row, header);

        if (!header || !value) {
          addIssue({
            type: "missing_required_field",
            category,
            rowIndex,
            sheetRowNumber,
            field: header || label,
            value: null,
            message: label + " is missing.",
            severity: label === "Facility Name" ? "critical" : "warning",
          });
        }
      }

      if (headerLookup.contact && contact && !hasValidPhoneToken(contact)) {
        addIssue({
          type: "invalid_phone",
          category,
          rowIndex,
          sheetRowNumber,
          field: headerLookup.contact,
          value: contact,
          message: "Contact does not look like a valid phone number.",
          severity: "warning",
        });
      }

      if (headerLookup.email && email && !isValidEmail(email)) {
        addIssue({
          type: "invalid_email",
          category,
          rowIndex,
          sheetRowNumber,
          field: headerLookup.email,
          value: email,
          message: "Email address format needs review.",
          severity: "warning",
        });
      }

      const identity: Omit<RowIdentity, "field" | "value"> = {
        category,
        rowIndex,
        sheetRowNumber,
        facilityName,
      };

      const normalizedEmail = normalizeEmail(email);
      const normalizedPhone = normalizePhoneNumber(contact);

      addIdentity(hefNoIdentities, hefNo.toLowerCase(), { ...identity, field: headerLookup.hefNo || "HEF/NO", value: hefNo });
      if (isValidEmail(normalizedEmail)) {
        addIdentity(emailIdentities, normalizedEmail, { ...identity, field: headerLookup.email || "Email", value: email });
      }
      if (normalizedPhone.length >= 7 && normalizedPhone.length <= 15) {
        addIdentity(phoneIdentities, normalizedPhone, { ...identity, field: headerLookup.contact || "Contact", value: contact });
      }

      const normalizedFacilityName = normalizeFacilityName(facilityName);
      const normalizedAddress = normalizeFacilityName(address);
      const nameAddressKey = normalizedFacilityName && normalizedAddress ? normalizedFacilityName + "|" + normalizedAddress : "";
      addIdentity(nameAddressIdentities, nameAddressKey, { ...identity, field: "Facility Name + Address", value: facilityName + " | " + address });
    });

    categories.set(category, summary);
  }

  for (const group of [
    ...duplicateGroups(hefNoIdentities),
    ...duplicateGroups(phoneIdentities),
    ...duplicateGroups(nameAddressIdentities),
  ]) {
    for (const identity of group) {
      addIssue({
        type: "duplicate_identity",
        category: identity.category,
        rowIndex: identity.rowIndex,
        sheetRowNumber: identity.sheetRowNumber,
        field: identity.field,
        value: identity.value,
        message: "Possible duplicate identity shared with " + (group.length - 1) + " other record" + (group.length === 2 ? "" : "s") + ".",
        severity: "warning",
        relatedRows: group
          .filter((entry) => entry.category !== identity.category || entry.rowIndex !== identity.rowIndex)
          .slice(0, 6),
      });
    }
  }

  const categoryList = [...categories.values()].sort((a, b) => b.issueCount - a.issueCount || a.category.localeCompare(b.category));

  return {
    scope: input.category ?? "all_categories",
    totalCategories: selectedCategories.length,
    totalRows,
    issueCount: issues.length,
    missingRequiredFields: issues.filter((issue) => issue.type === "missing_required_field").length,
    invalidPhones: issues.filter((issue) => issue.type === "invalid_phone").length,
    invalidEmails: issues.filter((issue) => issue.type === "invalid_email").length,
    duplicateWarnings: issues.filter((issue) => issue.type === "duplicate_identity").length,
    categories: categoryList,
    issues: issues.sort(
      (a, b) =>
        Number(b.severity === "critical") - Number(a.severity === "critical") ||
        a.category.localeCompare(b.category) ||
        a.rowIndex - b.rowIndex ||
        a.type.localeCompare(b.type),
    ),
  };
}
