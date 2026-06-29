import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";
import type { AuditEntry } from "@/types/audit";

type AuditDbRow = {
  id: number;
  timestamp: string;
  user: string;
  action_type: AuditEntry["actionType"];
  category: string | null;
  facility_name: string | null;
  affected_row: number | null;
  missing_fields: string | null;
  confidence_score: number | null;
  source_portal_url: string | null;
  status: AuditEntry["status"];
  details: string | null;
};

let auditDb: DatabaseSync | null = null;
function resolveAuditDbPath() {
  const databaseUrl = process.env.DATABASE_URL || "file:audit.db";
  const requestedFile = databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : databaseUrl;
  if (requestedFile && path.isAbsolute(requestedFile)) return requestedFile;
  return configuredRuntimeFile("HEFAMAA_AUDIT_DB_PATH", path.basename(requestedFile) || "audit.db");
}

function getAuditDb() {
  if (!auditDb) {
    const dbPath = resolveAuditDbPath();
    ensureRuntimeDataDirForFile(dbPath);
    auditDb = new DatabaseSync(dbPath);
    auditDb.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT NOT NULL,
        user TEXT NOT NULL,
        action_type TEXT NOT NULL,
        category TEXT,
        facility_name TEXT,
        affected_row INTEGER,
        missing_fields TEXT,
        confidence_score REAL,
        source_portal_url TEXT,
        status TEXT NOT NULL,
        details TEXT
      )
    `);
  }

  return auditDb;
}

function mapAuditRow(row: AuditDbRow): AuditEntry {
  return {
    id: row.id,
    timestamp: row.timestamp,
    user: row.user,
    actionType: row.action_type,
    category: row.category ?? undefined,
    facilityName: row.facility_name ?? undefined,
    affectedRow: row.affected_row ?? undefined,
    missingFields: row.missing_fields ? (JSON.parse(row.missing_fields) as string[]) : undefined,
    confidenceScore: row.confidence_score ?? undefined,
    sourcePortalUrl: row.source_portal_url ?? undefined,
    status: row.status,
    details: row.details ?? undefined,
  };
}

export function logAuditEntry(entry: Omit<AuditEntry, "id" | "timestamp"> & { timestamp?: string }) {
  const timestamp = entry.timestamp ?? new Date().toISOString();
  const db = getAuditDb();
  const result = db
    .prepare(
      `
      INSERT INTO audit_log (
        timestamp, user, action_type, category, facility_name, affected_row,
        missing_fields, confidence_score, source_portal_url, status, details
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(
      timestamp,
      entry.user,
      entry.actionType,
      entry.category ?? null,
      entry.facilityName ?? null,
      entry.affectedRow ?? null,
      JSON.stringify(entry.missingFields ?? []),
      entry.confidenceScore ?? null,
      entry.sourcePortalUrl ?? null,
      entry.status,
      entry.details ?? null,
    );

  return {
    ...entry,
    id: Number(result.lastInsertRowid),
    timestamp,
  };
}

export function listAuditEntries(limit = 100) {
  const db = getAuditDb();
  const rows = db
    .prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?")
    .all(limit) as AuditDbRow[];

  return rows.map(mapAuditRow);
}
