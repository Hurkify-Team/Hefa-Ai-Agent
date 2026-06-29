import type { DatabaseQuestionResult } from "@/types/ai";
import type { SheetRow } from "@/types/sheet";
import { checkDuplicateFacility } from "@/lib/duplicateChecker";
import { getSourceAllSheetData, isWorkbookSourceConfigured, readSourceExistingRecords, readSourceSheetTabs, WORKBOOK_SOURCE_LABELS, type WorkbookSource } from "@/lib/workbookSources";
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

export type HefamaaNumberLookupResult = {
  query: string;
  bestMatch: FacilitySearchResult | null;
  matches: FacilitySearchResult[];
  searchedSources: WorkbookSource[];
};

export const FIELD_ALIASES = {
  hefNo: ["HEF/NO", "HEF NO", "HEFAMAA NO", "HF NO", "REG NO", "Registration Number", "Registration No", "Facility Code", "FACILITY CODE", "FacilityCode", "Code"],
  facilityName: ["Facility Name", "FACILITY NAME", "Name", "Name of Facility", "FACILITY", "Facility"],
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
  matchScore?: number;
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


function dashboardSummaryMaxRows() {
  const value = Number(process.env.DASHBOARD_SUMMARY_MAX_ROWS ?? 500);
  return Number.isFinite(value) && value > 0 ? value : 500;
}

function limitSummarySheets(sheets: Record<string, { headers: string[]; rows: SheetRow[] }>) {
  const maxRows = dashboardSummaryMaxRows();
  return Object.fromEntries(
    Object.entries(sheets).map(([category, sheet]) => [
      category,
      {
        headers: sheet.headers,
        rows: sheet.rows.slice(0, maxRows),
      },
    ]),
  );
}

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

const FACILITY_LOOKUP_STOP_WORDS = new Set([
  "what",
  "is",
  "the",
  "me",
  "please",
  "kindly",
  "for",
  "of",
  "number",
  "no",
  "code",
  "hefamaa",
  "hef",
  "facility",
]);

function searchTokens(value: string) {
  return normalizeFacilityName(value)
    .replace(/[^a-z0-9/]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !FACILITY_LOOKUP_STOP_WORDS.has(token));
}

function facilityMatchScore(input: {
  address: string;
  category: string;
  contact: string;
  email: string;
  facilityName: string;
  hefNo: string;
  lga: string;
  rowText: string;
}, query: string) {
  const normalizedQuery = normalizeFacilityName(query);
  const lowerQuery = query.trim().toLowerCase();
  const normalizedName = normalizeFacilityName(input.facilityName);
  const normalizedRowText = normalizeFacilityName(input.rowText);
  const normalizedQueryPhone = normalizePhoneNumber(query);
  const normalizedContact = normalizePhoneNumber(input.contact);
  const lowerHefNo = input.hefNo.toLowerCase();

  if (!normalizedQuery) return 0;
  if (normalizedName === normalizedQuery) return 120;
  if (lowerHefNo && lowerHefNo === lowerQuery) return 118;
  if (normalizedQueryPhone && normalizedContact === normalizedQueryPhone) return 116;
  if (normalizedName.includes(normalizedQuery)) return 105;
  if (normalizedRowText.includes(normalizedQuery)) return 90;
  if (lowerHefNo && lowerHefNo.includes(lowerQuery)) return 88;

  const queryTokens = searchTokens(query);
  if (!queryTokens.length) return 0;

  const nameHits = queryTokens.filter((token) => normalizedName.includes(token)).length;
  const rowHits = queryTokens.filter((token) => normalizedRowText.includes(token)).length;

  if (nameHits === queryTokens.length) return 84 + nameHits;
  if (rowHits === queryTokens.length) return 70 + nameHits * 2;

  const hitRatio = rowHits / queryTokens.length;
  if (queryTokens.length >= 2 && hitRatio >= 0.66) {
    return 45 + Math.round(hitRatio * 10) + nameHits;
  }

  return 0;
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

export function extractHefamaaNumberLookupQuery(question: string) {
  const withoutPolitePrefix = question
    .replace(/^(?:please|kindly)\s+/i, "")
    .replace(/[?.!]+$/g, "")
    .trim();
  const patterns = [
    /(?:hefamaa|hef\/?no|hef\s*no|registration|facility\s+code)\s*(?:number|no|code)?\s+(?:for|of)\s+(.+)$/i,
    /(?:what(?:'s|\s+is)?|find|show|tell\s+me|provide|give)\s+(?:me\s+)?(?:the\s+)?(?:hefamaa|hef\/?no|hef\s*no|registration|facility\s+code)\s*(?:number|no|code)?\s+(?:for|of)\s+(.+)$/i,
    /(?:what(?:'s|\s+is)?|find|show|tell\s+me|provide|give)\s+(?:me\s+)?(.+?)\s+(?:hefamaa|hef\/?no|hef\s*no|registration|facility\s+code)\s*(?:number|no|code)?$/i,
    /(.+?)\s+(?:hefamaa|hef\/?no|hef\s*no|registration|facility\s+code)\s*(?:number|no|code)?$/i,
  ];

  for (const pattern of patterns) {
    const match = withoutPolitePrefix.match(pattern);
    if (match?.[1]) return cleanLookupQuery(match[1]);
  }

  if (/\b(?:hefamaa|hef|registration|facility\s+code)\b|hef\/?no/i.test(withoutPolitePrefix) && /\b(number|no|code)\b/i.test(withoutPolitePrefix)) {
    const parts = withoutPolitePrefix.split(/\b(?:for|of)\b/i);
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
    const lookup = await lookupHefamaaNumberAcrossSources({ query: hefamaaLookupQuery, category, limit: 8 });
    const bestMatch = lookup.bestMatch;

    if (!bestMatch) {
      return {
        question,
        answer: "No facility matching \"" + hefamaaLookupQuery + "\" was found in the HEFAMAA Active Database or Old Hefamaa Database fallback.",
      };
    }

    const numberLabel = bestMatch.source === "old" ? "Facility Code" : "HEF/NO";

    return {
      question,
      answer: [
        "The HEFAMAA number for " + (bestMatch.facilityName || hefamaaLookupQuery) + " is " + (bestMatch.hefNo || "Not found") + ".",
        "Source: " + bestMatch.sourceLabel + ", category " + bestMatch.category + ", row " + (bestMatch.rowIndex + 2) + ".",
        bestMatch.source === "old" ? "This value came from the old database header \"" + numberLabel + "\" because the active database did not provide a HEF/NO for the matched record." : "This value came from the active database HEF/NO column on the same row as the facility name.",
        bestMatch.address ? "Address: " + bestMatch.address + "." : "",
        bestMatch.lga ? "LGA: " + bestMatch.lga + "." : "",
      ]
        .filter(Boolean)
        .join(" "),
      rows: lookup.matches.map((match) => ({
        Source: match.sourceLabel,
        Category: match.category,
        "Workbook Row": match.rowIndex + 2,
        "HEF/NO / Facility Code": match.hefNo || null,
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

function categoryTokens(value: string) {
  return normalizeFacilityName(value)
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2);
}

function categoryHintScore(tabTitle: string, query: string) {
  const normalizedTitle = normalizeFacilityName(tabTitle);
  const normalizedQuery = normalizeFacilityName(query);

  if (!normalizedTitle || !normalizedQuery) return 0;
  if (normalizedQuery.includes(normalizedTitle)) return 120;

  const titleTokens = categoryTokens(tabTitle);
  const queryTokens = new Set(categoryTokens(query));
  if (!titleTokens.length || !queryTokens.size) return 0;

  const hits = titleTokens.filter((token) => queryTokens.has(token)).length;
  if (!hits) return 0;

  return Math.round((hits / titleTokens.length) * 80) + hits;
}

async function inferCategoryFromQuery(source: WorkbookSource, query: string) {
  const tabs = await readSourceSheetTabs(source);
  const ranked = tabs
    .map((tab) => ({ title: tab.title, score: categoryHintScore(tab.title, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

  return ranked[0]?.title ?? null;
}

function searchFacilitiesInData(
  sheets: WorkbookSheetData,
  input: SearchFacilitiesInput,
  source: WorkbookSource,
): FacilitySearchResult[] {
  const query = input.query.trim();

  if (!query) {
    return [];
  }

  const categories = input.category ? [input.category] : Object.keys(sheets);
  const matches: FacilitySearchResult[] = [];

  for (const category of categories) {
    const sheet = sheets[category];
    if (!sheet) continue;

    sheet.rows.forEach((row, rowIndex) => {
      const hefNo = valueFor(row, FIELD_ALIASES.hefNo);
      const facilityName = valueFor(row, FIELD_ALIASES.facilityName);
      const address = valueFor(row, FIELD_ALIASES.address);
      const lga = valueFor(row, FIELD_ALIASES.lga);
      const contact = valueFor(row, FIELD_ALIASES.contact);
      const email = valueFor(row, FIELD_ALIASES.email);
      const rowText = rowSearchText(category, row);
      const matchScore = facilityMatchScore({
        address,
        category,
        contact,
        email,
        facilityName,
        hefNo,
        lga,
        rowText,
      }, query);

      if (matchScore <= 0) return;

      matches.push({
        source,
        sourceLabel: WORKBOOK_SOURCE_LABELS[source],
        legacyOnly: source === "old",
        category,
        rowIndex,
        hefNo,
        facilityName,
        address,
        lga,
        contact,
        email,
        row,
        matchScore,
      });
    });
  }

  return sortFacilityMatches(matches, query);
}

function sortFacilityMatches(matches: FacilitySearchResult[], query: string) {
  const normalizedQuery = normalizeFacilityName(query);
  const lowerQuery = query.trim().toLowerCase();

  return matches.sort((a, b) => {
    const aName = normalizeFacilityName(a.facilityName);
    const bName = normalizeFacilityName(b.facilityName);
    const aExact = aName === normalizedQuery || a.hefNo.toLowerCase() === lowerQuery ? 1 : 0;
    const bExact = bName === normalizedQuery || b.hefNo.toLowerCase() === lowerQuery ? 1 : 0;
    const scorePriority = (b.matchScore ?? 0) - (a.matchScore ?? 0);
    const sourcePriority = (a.source === "active" ? 0 : 1) - (b.source === "active" ? 0 : 1);

    return bExact - aExact || scorePriority || sourcePriority || a.category.localeCompare(b.category) || aName.localeCompare(bName);
  });
}

export async function searchFacilitiesInSource(
  source: WorkbookSource,
  input: SearchFacilitiesInput,
): Promise<FacilitySearchResult[]> {
  const limit = input.limit ?? 75;

  if (input.category) {
    const sheet = await readSourceExistingRecords(source, input.category);
    return searchFacilitiesInData(
      {
        [sheet.category]: {
          headers: sheet.headers,
          rows: sheet.rows,
        },
      },
      { ...input, category: sheet.category },
      source,
    ).slice(0, limit);
  }

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

function bestHefamaaNumberMatch(matches: FacilitySearchResult[], query: string) {
  const normalizedQuery = normalizeFacilityName(query);
  const withNumber = matches.filter((match) => match.hefNo.trim());
  const candidates = withNumber.length ? withNumber : matches;

  return candidates.find((match) => normalizeFacilityName(match.facilityName) === normalizedQuery)
    ?? candidates.find((match) => normalizeFacilityName(match.facilityName).includes(normalizedQuery))
    ?? candidates[0]
    ?? null;
}

export async function lookupHefamaaNumberAcrossSources(input: SearchFacilitiesInput): Promise<HefamaaNumberLookupResult> {
  const query = input.query.trim();
  const limit = input.limit ?? 12;
  const searchedSources: WorkbookSource[] = ["active"];
  const activeCategory = input.category ?? await inferCategoryFromQuery("active", query).catch(() => null);
  const activeInput = activeCategory ? { ...input, category: activeCategory, limit } : { ...input, limit };
  const activeMatches = await searchFacilitiesInSource("active", activeInput);
  let oldMatches: FacilitySearchResult[] = [];

  const activeBest = bestHefamaaNumberMatch(sortFacilityMatches(activeMatches, query.toLowerCase()), query);

  if ((!activeBest || !activeBest.hefNo.trim()) && isWorkbookSourceConfigured("old")) {
    searchedSources.push("old");
    try {
      const oldCategory = input.category ?? await inferCategoryFromQuery("old", query).catch(() => activeCategory);
      oldMatches = await searchFacilitiesInSource("old", oldCategory ? { ...input, category: oldCategory, limit } : { ...input, limit });
    } catch (error) {
      console.warn(
        "Old Hefamaa Database HEF/NO fallback skipped:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  const combined = sortFacilityMatches([...activeMatches, ...oldMatches], query.toLowerCase()).slice(0, limit);
  const bestMatch = activeBest?.hefNo.trim() ? activeBest : bestHefamaaNumberMatch(combined, query);

  return {
    query,
    bestMatch,
    matches: combined,
    searchedSources,
  };
}

export async function buildWorkbookReportSummary(): Promise<WorkbookReportSummary> {
  const sheets = limitSummarySheets(await getSourceAllSheetData("active"));
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
