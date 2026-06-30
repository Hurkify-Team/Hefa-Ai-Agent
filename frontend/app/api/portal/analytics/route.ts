import { fail } from "@/lib/apiResponse";
import { NextResponse } from "next/server";
import { logMemory } from "@/lib/memory";
import { getNotificationDashboard } from "@/lib/notificationEngine";
import { getFastPortalFacilitySummary } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

const statusMap = {
  DOCUMENT_QUERIED: "document_queried",
  UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: "upload_payment_pending_document_approval",
  PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: "payment_approved_pending_document_approval",
  FINAL_APPROVAL_PENDING: "final_approval_pending",
} as const;

function countStatus(summary: ReturnType<typeof getFastPortalFacilitySummary>, key: keyof typeof statusMap) {
  return summary.statusCounts[statusMap[key]] ?? 0;
}

export async function GET() {
  console.log("[/api/portal/analytics] started");

  try {
    logMemory("/api/portal/analytics start");
    const summary = getFastPortalFacilitySummary();
    const notificationDashboard = getNotificationDashboard({ compact: true });
    const intelligence = notificationDashboard.intelligence ?? {};

    const payload = {
      success: true,
      totalScanned: summary.totalPortalRecords || summary.scanProgress.portalReportedRecords || summary.scanProgress.scannedRecords || 0,
      lastScanDate: summary.lastScanned || summary.scanProgress.completedAt || summary.scanProgress.startedAt || null,
      verifiedLive: Math.max(summary.detailRecords || 0, summary.scanProgress.scannedDetails || 0),
      staleCache: Number(intelligence.staleCacheCount ?? 0),
      statusCounts: {
        DOCUMENT_QUERIED: countStatus(summary, "DOCUMENT_QUERIED"),
        UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: countStatus(summary, "UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING"),
        PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: countStatus(summary, "PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING"),
        FINAL_APPROVAL_PENDING: countStatus(summary, "FINAL_APPROVAL_PENDING"),
      },
      actionCounts: {
        facilityReminderRequired: Number(intelligence.reminderQueueCount ?? notificationDashboard.reminderCandidates ?? 0),
        hefamaaAttentionRequired: Number(intelligence.hefamaaAttentionCount ?? 0),
      },
      cacheEmpty: !summary.totalPortalRecords && !summary.detailRecords,
      source: "portal-cache",
    };

    logMemory("/api/portal/analytics end");
    return NextResponse.json({ ...payload, ok: true, data: payload });
  } catch (error) {
    console.error("[/api/portal/analytics] failed", error);
    return fail(error, 500);
  }
}
