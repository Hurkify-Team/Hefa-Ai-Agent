import type { DatabaseQuestionResult } from "@/types/ai";
import type { SheetRow } from "@/types/sheet";
import { checkDuplicateFacility } from "@/lib/duplicateChecker";
import { getSourceAllSheetData, isWorkbookSourceConfigured, WORKBOOK_SOURCE_LABELS, type WorkbookSource } from "@/lib/workbookSources";
import {
  normalizeEmail,
  normalizeFacilityName,
  normalizeHeaderName,
  normalizeLGA,
  normalizePhoneNumber,
} from "@/lib/normalizers";

type SearchFacilitiesInput = {
  query: string;
  category?: string;
  limit?: number;
};

export const FIELD_ALIASES = {
  hefNo: ["HEF/NO", "HEF NO", "REG NO", "Registration Number"],
  facilityName: ["Facility Name", "FACILITY NAME", "Name"],
  address: ["Address", "ADDRESS", "Facility Address"],
  lga: ["LGA", "Local Government"],
  contact: ["Contact", "Phone", "Phone Number", "Phone No", "PHONE NO", "Telephone"],
  email: ["Facility E-Mail", "Facility Email", "Email", "E-Mail", "E-MAIL"],
};
const MAX_DATABASE_QUESTION_ROWS = 50;

export type FacilitySearchResult = {
  source: WorkbookSource;
  sourceLabel: string;
  legacyOnly?: boolean;
  category: string;
  rowIndex: number;
  hefNo: string;
  facilityName: string;
  address: string;
  lga: string;
  contact: string;
  email: string;
  row: SheetRow;
};

export type WorkbookReportSummary = {
  totalFacilities: number;
  totalCategories: number;
  incompleteRecords: number;
  categorySummary: Array<{
    category: string;
    rows: number;
    headers: number;
  }>;
  lgaSummary: Array<{
    lga: string;
    count: number;
  }>;
  missingDataSummary: Array<{
    category: string;
    missingRecords: number;
  }>;
  duplicateSummary: {
    exactDuplicateKeys: number;
    possibleDuplicateKeys: number;
  };
};

function rowHasMissingContact(row: SheetRow) {
  return !valueFor(row, FIELD_ALIASES.contact);
}

function valueFor(row: SheetRow, fields: string[]) {
  const normalizedLookup = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeaderName(key), value] as const),
  );

  for (const field of fields) {
    const directValue = row[field];
    if (directValue !== undefined && directValue !== null && String(directValue).trim()) {
      return String(directValue).trim();
    }

    const normalizedValue = normalizedLookup.get(normalizeHeaderName(field));
    if (normalizedValue !== undefined && normalizedValue !== null && String(normalizedValue).trim()) {
      return String(normalizedValue).trim();
    }
  }

  return "";
}

function rowSearchText(category: string, row: SheetRow) {
  return [
    category,
    ...Object.entries(row).flatMap(([key, value]) => [key, value == null ? "" : String(value)]),
  ]
    .join(" ")
    .toLowerCase();
}

function rowIsIncomplete(row: SheetRow) {
  const requiredValues = [
    valueFor(row, FIELD_ALIASES.facilityName),
    valueFor(row, FIELD_ALIASES.address),
    valueFor(row, FIELD_ALIASES.lga),
    valueFor(row, FIELD_ALIASES.contact),
  ];

  return requiredValues.some((value) => !value);
}

function sumNumericHeaders(rows: SheetRow[], keyword: string) {
  return rows.reduce((total, row) => {
    for (const [header, value] of Object.entries(row)) {
      if (normalizeHeaderName(header).includes(keyword)) {
        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) return total + numericValue;
      }
    }
    return total;
  }, 0);
}

function shouldReturnRows(lowerQuestion: string) {
  return /\b(show|list|display|find|search)\b/.test(lowerQuestion);
}

function limitedRows(rows: SheetRow[], lowerQuestion: string) {
  return shouldReturnRows(lowerQuestion) ? rows.slice(0, MAX_DATABASE_QUESTION_ROWS) : undefined;
}

function cleanLookupQuery(value: string) {
  return value
    .replace(/[?.!]+$/g, "")
    .replace(/^facility\s+/i, "")
    .trim();
}

function extractHefamaaNumberLookupQuery(question: string) {
  const patterns = [
    /(?:hefamaa|hef\/?no|hef\s*no|registration)\s*(?:number|no)?\s+(?:for|of)\s+(.+)$/i,
    /(?:what(?:'s|\s+is)?|find|show|tell\s+me)\s+(?:the\s+)?(?:hefamaa|hef\/?no|hef\s*no|registration)\s*(?:number|no)?\s+(?:for|of)\s+(.+)$/i,
  ];

  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) return cleanLookupQuery(match[1]);
  }

  if (/\bhef(?:amaa)?\b|hef\/?no|registration/i.test(question) && /\b(number|no)\b/i.test(question)) {
    const parts = question.split(/\b(?:for|of)\b/i);
    if (parts.length > 1) return cleanLookupQuery(parts.at(-1) ?? "");
  }

  return "";
}

export async function answerDatabaseQuestion(question: string, category?: string): Promise<DatabaseQuestionResult> {
  const sheets = await getSourceAllSheetData("active");
  const lowerQuestion = question.toLowerCase();
  const selectedCategories = category ? [category] : Object.keys(sheets);
  const rows = selectedCategories.flatMap((sheetCategory) => sheets[sheetCategory]?.rows ?? []);
  const hefamaaLookupQuery = extractHefamaaNumberLookupQuery(question);

  if (hefamaaLookupQuery) {
    const matches = await searchFacilitiesAcrossSources({ query: hefamaaLookupQuery, category, limit: 8 });
    const exactMatch = matches.find(
      (match) => normalizeFacilityName(match.facilityName) === normalizeFacilityName(hefamaaLookupQuery),
    );
    const bestMatch = exactMatch ?? matches[0];

    if (!bestMatch) {
      return {
        question,
        answer: "No facility matching \"" + hefamaaLookupQuery + "\" was found across the selected workbook data.",
      };
    }

    return {
      question,
      answer: [
        (bestMatch.facilityName || hefamaaLookupQuery) + " is in " + bestMatch.category + ".",
        "HEF/NO: " + (bestMatch.hefNo || "Not found") + ".",
        "Row: " + (bestMatch.rowIndex + 2) + ".",
        bestMatch.address ? "Address: " + bestMatch.address + "." : "",
        bestMatch.lga ? "LGA: " + bestMatch.lga + "." : "",
        bestMatch.contact ? "Contact: " + bestMatch.contact + "." : "",
      ]
        .filter(Boolean)
        .join(" "),
      rows: matches.map((match) => ({
        Category: match.category,
        "Workbook Row": match.rowIndex + 2,
        "HEF/NO": match.hefNo || null,
        "Facility Name": match.facilityName || null,
        Address: match.address || null,
        LGA: match.lga || null,
        Contact: match.contact || null,
        ...match.row,
      })),
    };
  }
  if (lowerQuestion.includes("missing contact")) {
    const missingRows = rows.filter(rowHasMissingContact);
    return {
      question,
      answer: `${missingRows.length} facilities have missing contact information.`,
      rows: limitedRows(missingRows, lowerQuestion),
    };
  }

  if (lowerQuestion.includes("duplicate")) {
    const duplicates = rows.flatMap((row, index) =>
      checkDuplicateFacility(row, rows.filter((_, otherIndex) => otherIndex !== index)).matches,
    );
    return {
      question,
      answer: `${duplicates.length} possible duplicate comparisons were found.`,
    };
  }

  if (lowerQuestion.includes("doctor")) {
    return {
      question,
      answer: `There are ${sumNumericHeaders(rows, "doctor")} doctors across the selected data.`,
    };
  }

  if (lowerQuestion.includes("nurse")) {
    return {
      question,
      answer: `There are ${sumNumericHeaders(rows, "nurse")} nurses across the selected data.`,
    };
  }

  if (lowerQuestion.includes("highest")) {
    const sorted = Object.entries(sheets).sort(([, a], [, b]) => b.rows.length - a.rows.length);
    const [topCategory, topSheet] = sorted[0];
    return {
      question,
      answer: `${topCategory} currently has the highest number of facilities with ${topSheet.rows.length} records.`,
    };
  }

  const lgaMatch = lowerQuestion.match(/\bin\s+([a-z\s-]+)\??$/i);
  if (lgaMatch) {
    const lga = normalizeLGA(lgaMatch[1]);
    const matchingRows = rows.filter((row) => normalizeLGA(valueFor(row, FIELD_ALIASES.lga)) === lga);
    return {
      question,
      answer: `${matchingRows.length} facilities are in ${lga}.`,
      rows: limitedRows(matchingRows, lowerQuestion),
    };
  }

  return {
    question,
    answer: `${rows.length} facilities are available across ${selectedCategories.length} selected categories.`,
  };
}

type WorkbookSheetData = Record<string, { headers: string[]; rows: SheetRow[] }>;

function searchFacilitiesInData(
  sheets: WorkbookSheetData,
  input: SearchFacilitiesInput,
  source: WorkbookSource,
): FacilitySearchResult[] {
  const query = input.query.trim().toLowerCase();

  if (!query) {
    return [];
  }

  const categories = input.category ? [input.category] : Object.keys(sheets);
  const matches: FacilitySearchResult[] = [];

  for (const category of categories) {
    const sheet = sheets[category];
    if (!sheet) continue;

    sheet.rows.forEach((row, rowIndex) => {
      if (!rowSearchText(category, row).includes(query)) return;

      matches.push({
        source,
        sourceLabel: WORKBOOK_SOURCE_LABELS[source],
        legacyOnly: source === "old",
        category,
        rowIndex,
        hefNo: valueFor(row, FIELD_ALIASES.hefNo),
        facilityName: valueFor(row, FIELD_ALIASES.facilityName),
        address: valueFor(row, FIELD_ALIASES.address),
        lga: valueFor(row, FIELD_ALIASES.lga),
        contact: valueFor(row, FIELD_ALIASES.contact),
        email: valueFor(row, FIELD_ALIASES.email),
        row,
      });
    });
  }

  return sortFacilityMatches(matches, query);
}

function sortFacilityMatches(matches: FacilitySearchResult[], query: string) {
  return matches.sort((a, b) => {
    const aName = normalizeFacilityName(a.facilityName);
    const bName = normalizeFacilityName(b.facilityName);
    const aExact = aName === query || a.hefNo.toLowerCase() === query ? 1 : 0;
    const bExact = bName === query || b.hefNo.toLowerCase() === query ? 1 : 0;
    const sourcePriority = (a.source === "active" ? 0 : 1) - (b.source === "active" ? 0 : 1);

    return bExact - aExact || sourcePriority || a.category.localeCompare(b.category) || aName.localeCompare(bName);
  });
}

export async function searchFacilitiesInSource(
  source: WorkbookSource,
  input: SearchFacilitiesInput,
): Promise<FacilitySearchResult[]> {
  const limit = input.limit ?? 75;
  const sheets = await getSourceAllSheetData(source);

  return searchFacilitiesInData(sheets, input, source).slice(0, limit);
}

export async function searchFacilities(input: SearchFacilitiesInput): Promise<FacilitySearchResult[]> {
  return searchFacilitiesInSource("active", input);
}

export async function searchFacilitiesAcrossSources(input: SearchFacilitiesInput): Promise<FacilitySearchResult[]> {
  const query = input.query.trim().toLowerCase();
  const limit = input.limit ?? 75;
  const activeMatches = await searchFacilitiesInSource("active", input);

  if (activeMatches.length > 0) {
    return sortFacilityMatches(activeMatches, query).slice(0, limit);
  }

  let oldMatches: FacilitySearchResult[] = [];

  if (isWorkbookSourceConfigured("old")) {
    try {
      oldMatches = await searchFacilitiesInSource("old", input);
    } catch (error) {
      console.warn(
        "Old Hefamaa Database fallback search skipped:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return sortFacilityMatches(oldMatches, query).slice(0, limit);
}

export async function buildWorkbookReportSummary(): Promise<WorkbookReportSummary> {
  const sheets = await getSourceAllSheetData("active");
  const categorySummary = Object.entries(sheets)
    .map(([category, sheet]) => ({
      category,
      rows: sheet.rows.length,
      headers: sheet.headers.length,
    }))
    .sort((a, b) => b.rows - a.rows);

  const lgaCounts = new Map<string, number>();
  const missingDataSummary: WorkbookReportSummary["missingDataSummary"] = [];
  const exactDuplicateKeys = new Set<string>();
  const possibleDuplicateKeys = new Set<string>();
  const seenIdentityKeys = new Map<string, string>();
  const seenPossibleKeys = new Map<string, string>();

  for (const [category, sheet] of Object.entries(sheets)) {
    let missingRecords = 0;

    for (const row of sheet.rows) {
      const lga = normalizeLGA(valueFor(row, FIELD_ALIASES.lga));
      if (lga) {
        lgaCounts.set(lga, (lgaCounts.get(lga) ?? 0) + 1);
      }

      if (rowIsIncomplete(row)) {
        missingRecords += 1;
      }

      const hefNo = valueFor(row, FIELD_ALIASES.hefNo).toLowerCase();
      const email = normalizeEmail(valueFor(row, FIELD_ALIASES.email));
      const phone = normalizePhoneNumber(valueFor(row, FIELD_ALIASES.contact));
      const name = normalizeFacilityName(valueFor(row, FIELD_ALIASES.facilityName));
      const address = normalizeFacilityName(valueFor(row, FIELD_ALIASES.address));
      const identityKey = hefNo || email || phone;
      const possibleKey = name && address ? `${name}|${address}` : "";

      if (identityKey) {
        const previous = seenIdentityKeys.get(identityKey);
        if (previous) {
          exactDuplicateKeys.add(identityKey);
        } else {
          seenIdentityKeys.set(identityKey, category);
        }
      }

      if (possibleKey) {
        const previous = seenPossibleKeys.get(possibleKey);
        if (previous) {
          possibleDuplicateKeys.add(possibleKey);
        } else {
          seenPossibleKeys.set(possibleKey, category);
        }
      }
    }

    missingDataSummary.push({
      category,
      missingRecords,
    });
  }

  return {
    totalFacilities: categorySummary.reduce((total, category) => total + category.rows, 0),
    totalCategories: categorySummary.length,
    incompleteRecords: missingDataSummary.reduce((total, item) => total + item.missingRecords, 0),
    categorySummary,
    lgaSummary: [...lgaCounts.entries()]
      .map(([lga, count]) => ({ lga, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 15),
    missingDataSummary: missingDataSummary.sort((a, b) => b.missingRecords - a.missingRecords),
    duplicateSummary: {
      exactDuplicateKeys: exactDuplicateKeys.size,
      possibleDuplicateKeys: possibleDuplicateKeys.size,
    },
  };
}
