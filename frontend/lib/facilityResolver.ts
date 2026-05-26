import { FIELD_ALIASES, searchFacilitiesInSource, type FacilitySearchResult } from "@/lib/sheetAnalyzer";
import { getWorkbookSourceConfig, readSourceExistingRecords, readSourceSheetTabs } from "@/lib/workbookSources";
import {
  compareFacilitySimilarity,
  normalizeEmail,
  normalizeFacilityName,
  normalizeHeaderName,
  normalizeLGA,
  normalizePhoneNumber,
} from "@/lib/normalizers";
import type { SheetRow, SheetRowValue } from "@/types/sheet";

export type LegacyFieldSuggestion = {
  header: string;
  activeValue: SheetRowValue | null;
  oldValue: SheetRowValue | null;
  status: "fill_from_old" | "conflict" | "same" | "empty";
  source: "old";
};

export type LegacyFallbackResolution = {
  configured: boolean;
  sourceLabel: string;
  readOnly: true;
  match: FacilitySearchResult | null;
  suggestions: LegacyFieldSuggestion[];
  fillableCount: number;
  conflictCount: number;
  sameCount: number;
  note: string;
};

type ResolveLegacyInput = {
  category: string;
  headers: string[];
  values: SheetRow;
};

function isBlankValue(value: SheetRowValue | undefined | null) {
  const text = String(value ?? "").trim();
  return !text || text === "-" || text === "--" || text === "—";
}

function compactHeader(header: string) {
  return normalizeHeaderName(header).replace(/[^a-z0-9]+/g, "");
}

function headerAliasCandidates(header: string) {
  const normalizedHeader = normalizeHeaderName(header);
  const compactedHeader = compactHeader(header);
  const candidates = new Set([normalizedHeader, compactedHeader]);

  for (const aliases of Object.values(FIELD_ALIASES)) {
    const normalizedAliases = aliases.map(normalizeHeaderName);
    const compactAliases = aliases.map(compactHeader);

    if (normalizedAliases.includes(normalizedHeader) || compactAliases.includes(compactedHeader)) {
      normalizedAliases.forEach((alias) => candidates.add(alias));
      compactAliases.forEach((alias) => candidates.add(alias));
    }
  }

  return candidates;
}

function valueForHeader(row: SheetRow, header: string) {
  const aliases = headerAliasCandidates(header);
  const entries = Object.entries(row);

  for (const [key, value] of entries) {
    if (aliases.has(normalizeHeaderName(key)) || aliases.has(compactHeader(key))) {
      return value;
    }
  }

  return null;
}

function comparableValue(header: string, value: SheetRowValue | null | undefined) {
  const normalizedHeader = normalizeHeaderName(header);

  if (normalizedHeader.includes("email") || normalizedHeader.includes("e-mail")) {
    return normalizeEmail(String(value ?? ""));
  }

  if (
    normalizedHeader.includes("phone") ||
    normalizedHeader.includes("contact") ||
    normalizedHeader.includes("telephone") ||
    normalizedHeader.includes("mobile")
  ) {
    return normalizePhoneNumber(value);
  }

  if (normalizedHeader === "lga" || normalizedHeader.includes("local government")) {
    return normalizeLGA(String(value ?? ""));
  }

  if (normalizedHeader.includes("facility") && normalizedHeader.includes("name")) {
    return normalizeFacilityName(String(value ?? ""));
  }

  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function valuesMatch(header: string, activeValue: SheetRowValue | null, oldValue: SheetRowValue | null) {
  return comparableValue(header, activeValue) === comparableValue(header, oldValue);
}

function candidateQueries(values: SheetRow) {
  const candidates = [
    valueForHeader(values, "HEF/NO"),
    valueForHeader(values, "Facility Name"),
    valueForHeader(values, "Contact"),
    valueForHeader(values, "Facility E-Mail"),
    valueForHeader(values, "Address"),
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  return Array.from(new Set(candidates));
}

function comparableCategoryName(category: string) {
  return normalizeHeaderName(category)
    .replace(/\b(home|hospital|clinic|centre|center|facility|facilities|medical|health|healthcare)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function oldCategoryCandidates(category: string) {
  const wanted = comparableCategoryName(category);
  const tabs = await readSourceSheetTabs("old");
  const candidates = tabs
    .filter((tab) => tab.headerCount > 0)
    .filter((tab) => {
      const current = comparableCategoryName(tab.title);
      return current === wanted || current.includes(wanted) || wanted.includes(current);
    })
    .map((tab) => tab.title);

  return Array.from(new Set(candidates));
}

function rowContainsQuery(category: string, row: SheetRow, query: string) {
  const lowerQuery = query.trim().toLowerCase();

  if (!lowerQuery) return false;

  return [category, ...Object.entries(row).flatMap(([key, value]) => [key, value == null ? "" : String(value)])]
    .join(" ")
    .toLowerCase()
    .includes(lowerQuery);
}

async function searchOldCategory(query: string, category: string): Promise<FacilitySearchResult[]> {
  const sheet = await readSourceExistingRecords("old", category);

  return sheet.rows
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(({ row }) => rowContainsQuery(sheet.category, row, query))
    .map(({ row, rowIndex }) => ({
      source: "old" as const,
      sourceLabel: "Old Hefamaa Database",
      legacyOnly: true,
      category: sheet.category,
      rowIndex,
      hefNo: String(valueForHeader(row, "HEF/NO") ?? "").trim(),
      facilityName: String(valueForHeader(row, "Facility Name") ?? "").trim(),
      address: String(valueForHeader(row, "Address") ?? "").trim(),
      lga: String(valueForHeader(row, "LGA") ?? "").trim(),
      contact: String(valueForHeader(row, "Contact") ?? "").trim(),
      email: String(valueForHeader(row, "Facility E-Mail") ?? "").trim(),
      row,
    }));
}

function matchScore(values: SheetRow, match: FacilitySearchResult) {
  const activeHef = comparableValue("HEF/NO", valueForHeader(values, "HEF/NO"));
  const activeName = String(valueForHeader(values, "Facility Name") ?? "");
  const activePhone = comparableValue("Contact", valueForHeader(values, "Contact"));
  const activeEmail = comparableValue("Facility E-Mail", valueForHeader(values, "Facility E-Mail"));
  const activeAddress = comparableValue("Address", valueForHeader(values, "Address"));

  let score = 0;
  if (activeHef && activeHef === comparableValue("HEF/NO", match.hefNo)) score += 1;
  if (activePhone && activePhone === comparableValue("Contact", match.contact)) score += 0.3;
  if (activeEmail && activeEmail === comparableValue("Facility E-Mail", match.email)) score += 0.3;
  if (activeAddress && activeAddress === comparableValue("Address", match.address)) score += 0.2;
  score += compareFacilitySimilarity(activeName, match.facilityName) * 0.8;

  return score;
}

async function findOldMatch(input: ResolveLegacyInput) {
  const queries = candidateQueries(input.values);
  const categories = await oldCategoryCandidates(input.category);
  const seen = new Map<string, FacilitySearchResult>();

  for (const query of queries) {
    for (const category of categories) {
      for (const match of await searchOldCategory(query, category)) {
        seen.set(match.category + ":" + match.rowIndex, match);
      }
    }

    if (seen.size === 0) {
      for (const match of await searchFacilitiesInSource("old", { query, limit: 15 })) {
        seen.set(match.category + ":" + match.rowIndex, match);
      }
    }
  }

  return [...seen.values()].sort((a, b) => matchScore(input.values, b) - matchScore(input.values, a))[0] ?? null;
}

function legacyAccessFailureNote(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("not found") || lowerMessage.includes("permission")) {
    return "Old Hefamaa Database could not be opened. Confirm OLD_GOOGLE_SHEET_ID and share the old workbook with the same Google service account used by this app.";
  }

  return "Old Hefamaa Database could not be read right now. " + (message || "Try again after checking the workbook connection.");
}

export async function resolveLegacyFallback(input: ResolveLegacyInput): Promise<LegacyFallbackResolution> {
  const config = getWorkbookSourceConfig("old");

  if (!config.configured) {
    return {
      configured: false,
      sourceLabel: config.label,
      readOnly: true,
      match: null,
      suggestions: [],
      fillableCount: 0,
      conflictCount: 0,
      sameCount: 0,
      note: "Old Hefamaa Database is not configured. Add OLD_GOOGLE_SHEET_ID to enable read-only fallback lookup.",
    };
  }

  let match: FacilitySearchResult | null = null;

  try {
    match = await findOldMatch(input);
  } catch (error) {
    return {
      configured: true,
      sourceLabel: config.label,
      readOnly: true,
      match: null,
      suggestions: [],
      fillableCount: 0,
      conflictCount: 0,
      sameCount: 0,
      note: legacyAccessFailureNote(error),
    };
  }

  if (!match) {
    return {
      configured: true,
      sourceLabel: config.label,
      readOnly: true,
      match: null,
      suggestions: [],
      fillableCount: 0,
      conflictCount: 0,
      sameCount: 0,
      note: "No matching legacy record was found in Old Hefamaa Database.",
    };
  }

  const suggestions = input.headers.map<LegacyFieldSuggestion>((header) => {
    const activeValue = input.values[header] ?? null;
    const oldValue = valueForHeader(match.row, header);

    if (isBlankValue(oldValue)) {
      return { header, activeValue, oldValue: null, status: "empty", source: "old" };
    }

    if (isBlankValue(activeValue)) {
      return { header, activeValue: null, oldValue, status: "fill_from_old", source: "old" };
    }

    if (valuesMatch(header, activeValue, oldValue)) {
      return { header, activeValue, oldValue, status: "same", source: "old" };
    }

    return { header, activeValue, oldValue, status: "conflict", source: "old" };
  });

  const fillableCount = suggestions.filter((suggestion) => suggestion.status === "fill_from_old").length;
  const conflictCount = suggestions.filter((suggestion) => suggestion.status === "conflict").length;
  const sameCount = suggestions.filter((suggestion) => suggestion.status === "same").length;

  return {
    configured: true,
    sourceLabel: config.label,
    readOnly: true,
    match,
    suggestions,
    fillableCount,
    conflictCount,
    sameCount,
    note:
      fillableCount > 0
        ? "Legacy match found. Old Database can fill " + fillableCount + " blank field" + (fillableCount === 1 ? "" : "s") + " after review."
        : conflictCount > 0
          ? "Legacy match found, but the useful differences are conflicts. Active/portal values are kept unless you edit manually."
          : "Legacy match found, but no missing active fields need fallback values.",
  };
}
