import { nonEmptyRows, readLimitedWorkbook } from "@/lib/lightweightSheets";

export type FacilitySearchResult = {
  source: "active" | "old";
  sourceLabel: string;
  legacyOnly?: boolean;
  sheet: string;
  category: string;
  rowNumber: number;
  rowIndex: number;
  facilityName: string;
  hefNumber: string;
  hefNo: string;
  lga: string;
  lcda: string;
  address: string;
  contact: string;
  email: string;
  ownerName: string;
  matchedFields: string[];
  confidence: number;
  row: Record<string, string>;
};

type IndexedFacilityRow = Omit<FacilitySearchResult, "confidence" | "matchedFields"> & {
  fieldText: Array<{ field: string; text: string }>;
  searchableText: string;
};

type SearchIndex = {
  expiresAt: number;
  rows: IndexedFacilityRow[];
};

type SearchIntent = {
  category?: string;
  lga?: string;
  missingEmail?: boolean;
  missingContact?: boolean;
  owner?: string;
  terms: string[];
};

const globalIndex = globalThis as typeof globalThis & { __hefaiFacilitySearchIndex?: SearchIndex };

function ttlMs() {
  const value = Number(process.env.FACILITY_SEARCH_CACHE_TTL_SECONDS ?? 900);
  return (Number.isFinite(value) && value > 0 ? value : 900) * 1000;
}

function maxRows() {
  const value = Number(process.env.DASHBOARD_SUMMARY_MAX_ROWS ?? 500);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 5000) : 500;
}

export function maxResults() {
  const value = Number(process.env.FACILITY_SEARCH_MAX_RESULTS ?? 50);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 200) : 50;
}

function compact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9/@.]+/g, " ").trim();
}

function words(value: string) {
  return normalize(value).split(/\s+/).filter((word) => word.length > 1);
}

function valueFor(row: Record<string, string>, names: string[]) {
  const entries = Object.entries(row);
  for (const name of names) {
    const direct = row[name];
    if (direct && direct.trim()) return direct.trim();
    const match = entries.find(([key]) => compact(key) === compact(name));
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return "";
}

const aliases = {
  address: ["Address", "ADDRESS", "Facility Address"],
  contact: ["Contact", "Phone", "Phone Number", "Phone No", "Telephone"],
  email: ["Facility E-Mail", "Facility Email", "Email", "E-Mail", "E-MAIL"],
  facilityName: ["Facility Name", "FACILITY NAME", "Name", "Name of Facility", "FACILITY"],
  hefNo: ["HEF/NO", "HEF NO", "HEFA NO", "HEFAMAA NO", "HF NO", "HEFA Number", "HEFAMAA Number", "Facility Code", "FACILITY CODE", "Facility ID", "Registration Number", "Registration No"],
  lcda: ["LCDA"],
  lga: ["LGA", "Local Government"],
  ownerName: ["Owner's Name", "Owners Name", "Owner Name", "Proprietor", "Proprietor Name", "Medical Director", "Operating Officer"],
};

function rowFieldText(row: Record<string, string>, category: string) {
  return [
    { field: "Category", text: category },
    ...Object.entries(row).map(([field, text]) => ({ field, text: String(text ?? "") })),
  ].filter((entry) => entry.text.trim());
}

async function buildIndex() {
  const workbook = await readLimitedWorkbook(maxRows());
  const rows: IndexedFacilityRow[] = [];
  for (const sheet of workbook.sheets) {
    if (!sheet.title) continue;
    nonEmptyRows(sheet.rows).forEach((row, index) => {
      const fieldText = rowFieldText(row, sheet.title);
      const hefNo = valueFor(row, aliases.hefNo);
      rows.push({
        source: "active",
        sourceLabel: "Hefamaa Active Database",
        sheet: sheet.title,
        category: sheet.title,
        rowNumber: index + 2,
        rowIndex: index,
        facilityName: valueFor(row, aliases.facilityName),
        hefNumber: hefNo,
        hefNo,
        lga: valueFor(row, aliases.lga),
        lcda: valueFor(row, aliases.lcda),
        address: valueFor(row, aliases.address),
        contact: valueFor(row, aliases.contact),
        email: valueFor(row, aliases.email),
        ownerName: valueFor(row, aliases.ownerName),
        fieldText,
        row,
        searchableText: normalize(fieldText.map((entry) => entry.field + " " + entry.text).join(" ")),
      });
    });
  }
  globalIndex.__hefaiFacilitySearchIndex = { expiresAt: Date.now() + ttlMs(), rows };
  return rows;
}

async function getIndex() {
  const cached = globalIndex.__hefaiFacilitySearchIndex;
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  return buildIndex();
}

const stopWords = new Set([
  "a", "an", "and", "by", "facility", "facilities", "find", "for", "in", "me", "of", "owned", "owner", "please", "search", "show", "the", "with",
]);

function singular(value: string) {
  if (value.endsWith("ies")) return value.slice(0, -3) + "y";
  if (value.endsWith("s") && value.length > 3) return value.slice(0, -1);
  return value;
}

function parseIntent(query: string): SearchIntent {
  const lower = normalize(query);
  const queryWords = words(query).filter((word) => !stopWords.has(word)).map(singular);
  const lgaMatch = lower.match(/\b(?:in|at|around)\s+([a-z0-9 ]{2,40})$/);
  const ownerMatch = lower.match(/\b(?:owned by|owner|proprietor)\s+([a-z0-9 .'-]{2,60})/);
  const category = ["laboratory", "hospital", "clinic", "maternity", "pharmacy", "radiology", "dental", "optical"].find((item) => lower.includes(item));
  return {
    category: category ? singular(category) : undefined,
    lga: lgaMatch?.[1]?.trim(),
    missingContact: /missing\s+(contact|phone|number)/.test(lower),
    missingEmail: /missing\s+(email|e-mail|mail)/.test(lower),
    owner: ownerMatch?.[1]?.trim(),
    terms: queryWords,
  };
}

function fuzzyIncludes(text: string, term: string) {
  const normalized = normalize(text);
  const normalizedTerm = normalize(term);
  if (!normalizedTerm) return true;
  if (normalized.includes(normalizedTerm)) return true;
  const compactText = compact(text);
  const compactTerm = compact(term);
  return compactTerm.length >= 4 && compactText.includes(compactTerm);
}

function scoreRow(row: IndexedFacilityRow, intent: SearchIntent) {
  const matchedFields = new Set<string>();
  let score = 0;

  if (intent.category) {
    if (!fuzzyIncludes(row.category, intent.category)) return null;
    score += 12;
    matchedFields.add("Category");
  }
  if (intent.lga) {
    if (!fuzzyIncludes(row.lga + " " + row.lcda + " " + row.address, intent.lga)) return null;
    score += 18;
    matchedFields.add(row.lga ? "LGA" : "Address");
  }
  if (intent.owner) {
    if (!fuzzyIncludes(row.ownerName + " " + row.searchableText, intent.owner)) return null;
    score += 18;
    matchedFields.add("Owner's Name");
  }
  if (intent.missingEmail) {
    if (row.email) return null;
    score += 20;
    matchedFields.add("Facility E-Mail");
  }
  if (intent.missingContact) {
    if (row.contact) return null;
    score += 20;
    matchedFields.add("Contact");
  }

  for (const term of intent.terms) {
    if (intent.category && term === singular(intent.category)) continue;
    let matched = false;
    for (const field of row.fieldText) {
      if (fuzzyIncludes(field.text, term) || fuzzyIncludes(field.field, term)) {
        matched = true;
        matchedFields.add(field.field);
        score += ["Facility Name", "HEF/NO", "LGA", "Address", "Contact"].includes(field.field) ? 8 : 4;
        break;
      }
    }
    if (!matched && term.length > 2) return null;
  }

  if (!score && intent.terms.length) return null;
  return { matchedFields: [...matchedFields], score };
}

export async function searchFacilityIndex(query: string, rawLimit?: number) {
  const limit = Math.max(1, Math.min(rawLimit ?? maxResults(), maxResults()));
  const intent = parseIntent(query);
  const rows = await getIndex();
  const results: FacilitySearchResult[] = rows
    .reduce<FacilitySearchResult[]>((acc, row) => {
      const match = scoreRow(row, intent);
      if (!match) return acc;
      const { fieldText: _fieldText, searchableText: _searchableText, ...publicRow } = row;
      acc.push({
        ...publicRow,
        confidence: Math.max(0.35, Math.min(0.99, match.score / 60)),
        matchedFields: match.matchedFields.length ? match.matchedFields : ["Row"],
      });
      return acc;
    }, [])
    .sort((a, b) => b.confidence - a.confidence || a.sheet.localeCompare(b.sheet) || a.rowNumber - b.rowNumber)
    .slice(0, limit);

  return { intent, results, total: results.length };
}
