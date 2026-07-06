import { fail } from "@/lib/apiResponse";
import { NextResponse } from "next/server";
import { logMemory } from "@/lib/memory";
import { getNotificationDashboard } from "@/lib/notificationEngine";
import { getFastPortalFacilitySummary } from "@/lib/playwrightPortal";
import { buildPortalWorkflowSummary } from "@/lib/portalWorkflow";

export const runtime = "nodejs";

export async function GET() {
  console.log("[/api/portal/analytics] started");

  try {
    logMemory("/api/portal/analytics start");
    const summary = getFastPortalFacilitySummary();
    const notificationDashboard = getNotificationDashboard({ compact: true });
    const workflowSummary = buildPortalWorkflowSummary();
    const intelligence = notificationDashboard.intelligence ?? {};

    const payload = {
      success: true,
      totalScanned: summary.totalPortalRecords || summary.scanProgress.portalReportedRecords || summary.scanProgress.scannedRecords || 0,
      lastScanDate: summary.lastScanned || summary.scanProgress.completedAt || summary.scanProgress.startedAt || null,
      verifiedLive: Math.max(summary.detailRecords || 0, summary.scanProgress.scannedDetails || 0),
      staleCache: Number(intelligence.staleCacheCount ?? 0),
      statusCounts: {
        DOCUMENT_QUERY: workflowSummary.statusCounts.DOCUMENT_QUERY,
        DOCUMENT_QUERIED: workflowSummary.statusCounts.DOCUMENT_QUERY,
        UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING: workflowSummary.statusCounts.UPLOAD_PAYMENT_DOCUMENT_APPROVAL_PENDING,
        PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING: workflowSummary.statusCounts.PAYMENT_APPROVED_DOCUMENT_APPROVAL_PENDING,
        DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING: workflowSummary.statusCounts.DOCUMENT_APPROVED_INSPECTION_REPORT_PENDING,
        INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING: workflowSummary.statusCounts.INSPECTION_REPORT_UPLOAD_INSPECTION_APPROVAL_PENDING,
        FINAL_APPROVAL_PENDING: workflowSummary.statusCounts.FINAL_APPROVAL_PENDING,
        REGISTRATION_APPROVED: workflowSummary.statusCounts.REGISTRATION_APPROVED,
      },
      sectorCounts: workflowSummary.sectorCounts,
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
