export type AuditActionType =
  | "add"
  | "update"
  | "category_created"
  | "analysis"
  | "capture"
  | "duplicate_check"
  | "cleaning";

export type AuditEntry = {
  id?: number;
  timestamp: string;
  user: string;
  actionType: AuditActionType;
  category?: string;
  facilityName?: string;
  affectedRow?: number;
  missingFields?: string[];
  confidenceScore?: number;
  sourcePortalUrl?: string;
  status: "success" | "warning" | "failed";
  details?: string;
};
