import { safeApi } from "@/lib/apiResponse";
import { seedPortalScanSnapshotFromCurrentCache } from "@/lib/portalIntelligence";
import { readPortalScanSnapshots, summarizePortalScanHistory, type PortalScanSnapshot } from "@/lib/portalScanSnapshots";

export const runtime = "nodejs";

function compactSnapshot(snapshot: PortalScanSnapshot) {
  const { recordKeys, ...rest } = snapshot;
  return {
    ...rest,
    recordKeyCount: recordKeys.length,
  };
}

function compactHistory() {
  const history = summarizePortalScanHistory();
  return {
    ...history,
    latest: history.latest ? compactSnapshot(history.latest) : null,
  };
}

function snapshotResponse() {
  const snapshots = readPortalScanSnapshots();
  return {
    history: compactHistory(),
    snapshots: snapshots.map(compactSnapshot),
  };
}

export async function GET() {
  return safeApi("/api/portal/snapshots", () => snapshotResponse());
}

export async function POST() {
  return safeApi("/api/portal/snapshots", () => {
    const snapshot = seedPortalScanSnapshotFromCurrentCache();
    return {
      ...snapshotResponse(),
      snapshot: compactSnapshot(snapshot),
    };
  });
}
