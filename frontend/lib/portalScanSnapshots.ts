import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { PortalFacilityRecord } from "@/lib/playwrightPortal";

type PortalScanSnapshotInput = {
  categoryCounts: Array<{ category: string; count: number }>;
  distinctFacilities: number;
  existingFacilities: number;
  indexedRows: number;
  newFacilities: number;
  portalReportedRecords: number | null;
  records: PortalFacilityRecord[];
  scannedPages: number;
  scannedRecords: number;
  statusCounts: Record<string, number>;
  unknownFacilities: number;
};

export type PortalScanSnapshot = {
  categoryCounts: Array<{ category: string; count: number }>;
  distinctFacilities: number;
  existingFacilities: number;
  id: string;
  indexedRows: number;
  newFacilities: number;
  portalReportedRecords: number | null;
  recordKeys: string[];
  scannedAt: string;
  scannedPages: number;
  scannedRecords: number;
  statusCounts: Record<string, number>;
  unknownFacilities: number;
};

const MAX_SNAPSHOTS = 60;

function snapshotsPath() {
  const configuredPath = process.env.HEFAMAA_PORTAL_SCAN_SNAPSHOTS?.trim() || "data/portal-scan-snapshots.json";
  return path.isAbsolute(configuredPath) ? configuredPath : path.join(process.cwd(), configuredPath);
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function portalRecordStableKey(record: PortalFacilityRecord) {
  return [
    normalizeKey(record.hefamaaId || ""),
    normalizeKey(record.facilityName || ""),
    normalizeKey(record.category || ""),
    record.renewalYear ?? "",
  ].join("|");
}

export function readPortalScanSnapshots(): PortalScanSnapshot[] {
  const file = snapshotsPath();
  if (!existsSync(file)) return [];

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePortalScanSnapshots(snapshots: PortalScanSnapshot[]) {
  const file = snapshotsPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshots.slice(-MAX_SNAPSHOTS), null, 2), "utf8");
}

export function writePortalScanSnapshot(input: PortalScanSnapshotInput) {
  const scannedAt = new Date().toISOString();
  const snapshot: PortalScanSnapshot = {
    categoryCounts: input.categoryCounts,
    distinctFacilities: input.distinctFacilities,
    existingFacilities: input.existingFacilities,
    id: scannedAt,
    indexedRows: input.indexedRows,
    newFacilities: input.newFacilities,
    portalReportedRecords: input.portalReportedRecords,
    recordKeys: Array.from(new Set(input.records.map(portalRecordStableKey).filter(Boolean))),
    scannedAt,
    scannedPages: input.scannedPages,
    scannedRecords: input.scannedRecords,
    statusCounts: input.statusCounts,
    unknownFacilities: input.unknownFacilities,
  };
  const snapshots = readPortalScanSnapshots();
  writePortalScanSnapshots([...snapshots, snapshot]);
  return snapshot;
}

function snapshotDelta(latest: PortalScanSnapshot, previous: PortalScanSnapshot | null) {
  if (!previous) {
    return {
      addedPortalRows: null,
      indexedRowsDelta: null,
      removedPortalRows: null,
    };
  }

  const previousKeys = new Set(previous.recordKeys);
  const latestKeys = new Set(latest.recordKeys);
  let addedPortalRows = 0;
  let removedPortalRows = 0;

  for (const key of latestKeys) if (!previousKeys.has(key)) addedPortalRows += 1;
  for (const key of previousKeys) if (!latestKeys.has(key)) removedPortalRows += 1;

  return {
    addedPortalRows,
    indexedRowsDelta: latest.indexedRows - previous.indexedRows,
    removedPortalRows,
  };
}

function latestSnapshotBefore(snapshots: PortalScanSnapshot[], date: Date) {
  return snapshots
    .filter((snapshot) => new Date(snapshot.scannedAt).getTime() <= date.getTime())
    .at(-1) ?? null;
}

export function summarizePortalScanHistory(now = new Date()) {
  const snapshots = readPortalScanSnapshots().sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
  const latest = snapshots.at(-1) ?? null;

  if (!latest) {
    return {
      latest: null,
      snapshotCount: 0,
      daily: null,
      weekly: null,
      monthly: null,
      note: "No portal scan snapshots exist yet. Run a full scan to create the baseline.",
    };
  }

  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    latest,
    snapshotCount: snapshots.length,
    daily: snapshotDelta(latest, latestSnapshotBefore(snapshots, oneDayAgo)),
    weekly: snapshotDelta(latest, latestSnapshotBefore(snapshots, sevenDaysAgo)),
    monthly: snapshotDelta(latest, latestSnapshotBefore(snapshots, thirtyDaysAgo)),
    note: snapshots.length < 2 ? "This is the first scan snapshot. Daily, weekly, and monthly movement will become exact after repeated scans." : undefined,
  };
}
