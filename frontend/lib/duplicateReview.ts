import { getAllSheetData, updateSheetCells, type SheetCellUpdate } from "@/lib/googleSheets";
import {
  normalizeFacilityName,
  normalizeHeaderName,
  normalizePhoneNumber,
} from "@/lib/normalizers";
import type { SheetRow } from "@/types/sheet";

const FIELD_ALIASES = {
  hefNo: ["HEF/NO", "HEF NO", "REG NO", "Registration Number"],
  facilityName: ["Facility Name", "FACILITY NAME", "Name"],
  address: ["Address", "ADDRESS", "Facility Address"],
  lga: ["LGA", "Local Government"],
  contact: ["Contact", "Phone", "Phone Number", "Phone No", "PHONE NO", "Telephone"],
  remark: ["Remark", "Remarks", "Comment", "Comments", "Status Note", "Notes"],
};

export type DuplicateGroupType = "hef_no" | "phone" | "name_address";

export type DuplicateGroupRecord = {
  category: string;
  rowIndex: number;
  sheetRowNumber: number;
  facilityName: string;
  hefNo: string;
  address: string;
  lga: string;
  contact: string;
  remarkHeader: string | null;
  row: SheetRow;
};

export type DuplicateReviewGroup = {
  id: string;
  type: DuplicateGroupType;
  label: string;
  key: string;
  severity: "exact" | "possible";
  recordCount: number;
  categories: string[];
  records: DuplicateGroupRecord[];
  canMarkForReview: boolean;
};

export type DuplicateReviewSummary = {
  scope: string;
  totalCategories: number;
  totalRows: number;
  groupCount: number;
  exactGroupCount: number;
  possibleGroupCount: number;
  groups: DuplicateReviewGroup[];
};

export type MarkDuplicateReviewResult = {
  updatedCells: number;
  group: DuplicateReviewGroup;
};

export type DuplicateMergeSuggestion = {
  field: string;
  keeperValue: string;
  suggestedValue: string;
  sourceCategory: string;
  sourceRowIndex: number;
  sourceSheetRowNumber: number;
  sourceFacilityName: string;
};

export type DuplicateMergeConflict = {
  field: string;
  keeperValue: string;
  sourceValue: string;
  sourceCategory: string;
  sourceSheetRowNumber: number;
};

export type DuplicateMergePlan = {
  group: DuplicateReviewGroup;
  keeper: DuplicateGroupRecord;
  suggestions: DuplicateMergeSuggestion[];
  conflicts: DuplicateMergeConflict[];
};

export type ApplyDuplicateMergeResult = {
  updatedCells: number;
  plan: DuplicateMergePlan;
};

type IndexedRecord = DuplicateGroupRecord & {
  normalizedHefNo: string;
  normalizedPhone: string;
  normalizedName: string;
  normalizedAddress: string;
};

function stableId(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 90);
}

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

function usableText(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.length > 3 && !/^(n\/?a|nil|none|not available|not applicable|-+)$/.test(normalized);
}

function addToMap(map: Map<string, IndexedRecord[]>, key: string, record: IndexedRecord) {
  if (!usableText(key)) return;
  const rows = map.get(key) ?? [];
  rows.push(record);
  map.set(key, rows);
}

function duplicateGroups(identityMap: Map<string, IndexedRecord[]>) {
  return [...identityMap.values()].filter((group) => group.length > 1);
}

function nonEmptyValue(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function sameValue(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function publicRecord(record: IndexedRecord): DuplicateGroupRecord {
  const { normalizedAddress, normalizedHefNo, normalizedName, normalizedPhone, ...cleanRecord } = record;
  void normalizedAddress;
  void normalizedHefNo;
  void normalizedName;
  void normalizedPhone;
  return cleanRecord;
}

function summarizeGroup(type: DuplicateGroupType, key: string, records: IndexedRecord[]): DuplicateReviewGroup | null {
  if (records.length < 2) return null;

  const severity = type === "name_address" ? "possible" : "exact";
  const label = type === "hef_no" ? "HEF/NO Match" : type === "phone" ? "Contact Match" : "Name + Address Match";
  const categories = [...new Set(records.map((record) => record.category))].sort((a, b) => a.localeCompare(b));
  const publicRecords = records.map(publicRecord);

  return {
    id: type + "-" + stableId(key),
    type,
    label,
    key,
    severity,
    recordCount: records.length,
    categories,
    records: publicRecords,
    canMarkForReview: publicRecords.some((record) => record.remarkHeader),
  };
}

function sortGroups(a: DuplicateReviewGroup, b: DuplicateReviewGroup) {
  return (
    Number(b.severity === "exact") - Number(a.severity === "exact") ||
    b.recordCount - a.recordCount ||
    a.label.localeCompare(b.label) ||
    a.key.localeCompare(b.key)
  );
}

export async function analyzeDuplicateGroups(input: { category?: string; limit?: number } = {}): Promise<DuplicateReviewSummary> {
  const sheets = await getAllSheetData();
  const selectedCategories = input.category ? [input.category] : Object.keys(sheets);
  const byHefNo = new Map<string, IndexedRecord[]>();
  const byPhone = new Map<string, IndexedRecord[]>();
  const byNameAddress = new Map<string, IndexedRecord[]>();
  let totalRows = 0;

  for (const category of selectedCategories) {
    const sheet = sheets[category];
    if (!sheet) continue;

    totalRows += sheet.rows.length;

    const headers = {
      hefNo: findHeader(sheet.headers, FIELD_ALIASES.hefNo),
      facilityName: findHeader(sheet.headers, FIELD_ALIASES.facilityName),
      address: findHeader(sheet.headers, FIELD_ALIASES.address),
      lga: findHeader(sheet.headers, FIELD_ALIASES.lga),
      contact: findHeader(sheet.headers, FIELD_ALIASES.contact),
      remark: findHeader(sheet.headers, FIELD_ALIASES.remark),
    };

    sheet.rows.forEach((row, rowIndex) => {
      const facilityName = valueForHeader(row, headers.facilityName);
      const address = valueForHeader(row, headers.address);
      const contact = valueForHeader(row, headers.contact);
      const normalizedPhone = normalizePhoneNumber(contact);
      const normalizedName = normalizeFacilityName(facilityName);
      const normalizedAddress = normalizeFacilityName(address);
      const normalizedHefNo = valueForHeader(row, headers.hefNo).toLowerCase();
      const nameAddressKey = normalizedName && normalizedAddress ? normalizedName + "|" + normalizedAddress : "";

      const record: IndexedRecord = {
        category,
        rowIndex,
        sheetRowNumber: rowIndex + 2,
        facilityName,
        hefNo: valueForHeader(row, headers.hefNo),
        address,
        lga: valueForHeader(row, headers.lga),
        contact,
        remarkHeader: headers.remark || null,
        row,
        normalizedHefNo,
        normalizedPhone,
        normalizedName,
        normalizedAddress,
      };

      addToMap(byHefNo, normalizedHefNo, record);
      if (normalizedPhone.length >= 7 && normalizedPhone.length <= 15) {
        addToMap(byPhone, normalizedPhone, record);
      }
      addToMap(byNameAddress, nameAddressKey, record);
    });
  }

  const exactRows = new Set<string>();
  const groups: DuplicateReviewGroup[] = [];

  for (const [key, records] of byHefNo.entries()) {
    const group = summarizeGroup("hef_no", key, records);
    if (!group) continue;
    groups.push(group);
    for (const record of records) exactRows.add(record.category + ":" + record.rowIndex);
  }

  for (const [key, records] of byPhone.entries()) {
    const filtered = records.filter((record) => !exactRows.has(record.category + ":" + record.rowIndex));
    const group = summarizeGroup("phone", key, filtered);
    if (group) groups.push(group);
  }

  for (const [key, records] of byNameAddress.entries()) {
    const filtered = records.filter((record) => !exactRows.has(record.category + ":" + record.rowIndex));
    const group = summarizeGroup("name_address", key, filtered);
    if (group) groups.push(group);
  }

  const sortedGroups = groups.sort(sortGroups).slice(0, input.limit ?? 100);

  return {
    scope: input.category ?? "all_categories",
    totalCategories: selectedCategories.length,
    totalRows,
    groupCount: groups.length,
    exactGroupCount: groups.filter((group) => group.severity === "exact").length,
    possibleGroupCount: groups.filter((group) => group.severity === "possible").length,
    groups: sortedGroups,
  };
}


function findGroup(summary: DuplicateReviewSummary, groupId: string) {
  const group = summary.groups.find((item) => item.id === groupId);

  if (!group) {
    throw new Error("Duplicate group was not found. Refresh duplicate analysis and try again.");
  }

  return group;
}

function findKeeper(group: DuplicateReviewGroup, keeperCategory: string, keeperRowIndex: number) {
  const keeper = group.records.find(
    (record) =>
      normalizeHeaderName(record.category) === normalizeHeaderName(keeperCategory) &&
      record.rowIndex === keeperRowIndex,
  );

  if (!keeper) {
    throw new Error("Keeper row was not found in this duplicate group. Refresh duplicate analysis and try again.");
  }

  return keeper;
}

function normalizedHeaderIndex(row: SheetRow) {
  return new Map(Object.keys(row).map((header) => [normalizeHeaderName(header), header] as const));
}

function mergeCandidates(group: DuplicateReviewGroup, keeper: DuplicateGroupRecord) {
  const keeperHeaderIndex = normalizedHeaderIndex(keeper.row);
  const suggestions = new Map<string, DuplicateMergeSuggestion>();
  const conflicts = new Map<string, DuplicateMergeConflict>();

  for (const source of group.records) {
    if (source.category === keeper.category && source.rowIndex === keeper.rowIndex) {
      continue;
    }

    const sourceHeaderIndex = normalizedHeaderIndex(source.row);

    for (const [normalizedHeader, keeperHeader] of keeperHeaderIndex.entries()) {
      const sourceHeader = sourceHeaderIndex.get(normalizedHeader);
      if (!sourceHeader) continue;

      const keeperValue = String(keeper.row[keeperHeader] ?? "").trim();
      const sourceValue = String(source.row[sourceHeader] ?? "").trim();

      if (!nonEmptyValue(sourceValue)) continue;

      if (!nonEmptyValue(keeperValue)) {
        if (!suggestions.has(keeperHeader)) {
          suggestions.set(keeperHeader, {
            field: keeperHeader,
            keeperValue,
            suggestedValue: sourceValue,
            sourceCategory: source.category,
            sourceRowIndex: source.rowIndex,
            sourceSheetRowNumber: source.sheetRowNumber,
            sourceFacilityName: source.facilityName,
          });
        }
        continue;
      }

      if (!sameValue(keeperValue, sourceValue) && !conflicts.has(keeperHeader + "|" + source.category + "|" + source.rowIndex)) {
        conflicts.set(keeperHeader + "|" + source.category + "|" + source.rowIndex, {
          field: keeperHeader,
          keeperValue,
          sourceValue,
          sourceCategory: source.category,
          sourceSheetRowNumber: source.sheetRowNumber,
        });
      }
    }
  }

  return {
    suggestions: [...suggestions.values()],
    conflicts: [...conflicts.values()].slice(0, 100),
  };
}

export async function buildDuplicateMergePlan(input: {
  groupId: string;
  keeperCategory: string;
  keeperRowIndex: number;
  category?: string;
}): Promise<DuplicateMergePlan> {
  const summary = await analyzeDuplicateGroups({ category: input.category, limit: 500 });
  const group = findGroup(summary, input.groupId);
  const keeper = findKeeper(group, input.keeperCategory, input.keeperRowIndex);
  const candidates = mergeCandidates(group, keeper);

  return {
    group,
    keeper,
    suggestions: candidates.suggestions,
    conflicts: candidates.conflicts,
  };
}

export async function applyDuplicateMerge(input: {
  groupId: string;
  keeperCategory: string;
  keeperRowIndex: number;
  selectedFields: string[];
  category?: string;
}): Promise<ApplyDuplicateMergeResult> {
  const plan = await buildDuplicateMergePlan(input);
  const selected = new Set(input.selectedFields);
  const allowed = new Set(plan.suggestions.map((suggestion) => suggestion.field));

  for (const field of selected) {
    if (!allowed.has(field)) {
      throw new Error('Field "' + field + '" is not an available duplicate merge suggestion.');
    }
  }

  const updates: SheetCellUpdate[] = plan.suggestions
    .filter((suggestion) => selected.has(suggestion.field))
    .map((suggestion) => ({
      category: plan.keeper.category,
      rowIndex: plan.keeper.rowIndex,
      field: suggestion.field,
      value: suggestion.suggestedValue,
    }));

  const result = await updateSheetCells(updates);

  return {
    updatedCells: result.updatedCells,
    plan,
  };
}

export async function markDuplicateGroupForReview(input: { groupId: string; category?: string }) {
  const summary = await analyzeDuplicateGroups({ category: input.category, limit: 500 });
  const group = findGroup(summary, input.groupId);

  const updates: SheetCellUpdate[] = group.records
    .filter((record) => record.remarkHeader)
    .map((record) => ({
      category: record.category,
      rowIndex: record.rowIndex,
      field: record.remarkHeader as string,
      value: "POSSIBLE DUPLICATE REVIEW: " + group.label + " (" + group.key + ")",
    }));

  if (!updates.length) {
    throw new Error("None of the records in this duplicate group has a Remark/Notes column to mark.");
  }

  const result = await updateSheetCells(updates);

  return {
    updatedCells: result.updatedCells,
    group,
  } satisfies MarkDuplicateReviewResult;
}
