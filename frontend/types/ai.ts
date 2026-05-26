import type { SheetRow } from "@/types/sheet";

export type FieldMappingInput = {
  category: string;
  headers: string[];
  sampleRows: SheetRow[];
  portalText: string;
};

export type FieldMappingResult = {
  category: string;
  matchedFields: SheetRow;
  missingFields: string[];
  confidence: number;
  notes: string[];
};

export type DatabaseQuestionResult = {
  question: string;
  answer: string;
  rows?: SheetRow[];
};
