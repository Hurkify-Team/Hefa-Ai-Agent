import type { SheetRow } from "@/types/sheet";

export type FacilityCategory = string;

export type ExtractedFacility = {
  category: FacilityCategory;
  values: SheetRow;
  missingFields: string[];
  confidence: number;
  sourcePortalUrl?: string;
};

export type DuplicateStatus = "no_duplicate" | "possible_duplicate" | "exact_duplicate";

export type DuplicateMatch = {
  rowIndex: number;
  score: number;
  reasons: string[];
  row: SheetRow;
};

export type DuplicateCheckResult = {
  status: DuplicateStatus;
  matches: DuplicateMatch[];
};
