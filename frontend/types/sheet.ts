export type SheetRowValue = string | number | null;

export type SheetRow = Record<string, SheetRowValue>;

export type SheetTab = {
  title: string;
  rowCount: number;
  headerCount: number;
};

export type SheetHeaderResult = {
  category: string;
  headers: string[];
};

export type SheetRowsResult = {
  category: string;
  headers: string[];
  rows: SheetRow[];
};

export type CreateSheetInput = {
  category: string;
  headers: string[];
};
