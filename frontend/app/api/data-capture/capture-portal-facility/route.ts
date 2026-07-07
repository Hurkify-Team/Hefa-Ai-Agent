import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { buildDataCapturePreview } from "@/lib/dataCaptureWorkflow";
import { captureSelectedPortalFacilityDetail, getPortalSessionManagerStatus, openSearchResultRecord, searchFacility } from "@/lib/playwrightPortal";
import { safeRequestJson } from "@/lib/safeJson";

export const runtime = "nodejs";

const schema = z.object({
  portalFacilityId: z.union([z.string(), z.number()]).optional(),
  rowIndex: z.number().int().min(0).optional(),
  facilityName: z.string().trim().optional(),
});

function rowIndexFromPortalFacilityId(value: string | number | undefined) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return null;
}

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await safeRequestJson(request, "app/api/data-capture/capture-portal-facility/route.ts"));
    const status = await getPortalSessionManagerStatus();
    if (!status.browserOpen || !status.loggedIn) {
      throw new Error("Please open portal and login first.");
    }

    const rowIndex = payload.rowIndex ?? rowIndexFromPortalFacilityId(payload.portalFacilityId);
    if (payload.facilityName?.trim()) {
      await searchFacility({ facilityName: payload.facilityName.trim(), openSelectedRecord: true });
    } else if (typeof rowIndex === "number") {
      await openSearchResultRecord({ rowIndex });
    }

    const detail = await captureSelectedPortalFacilityDetail();
    const preview = await buildDataCapturePreview(detail);

    return ok({
      success: true,
      capturedData: preview.capturedData,
      confidence: preview.confidence,
      duplicate: preview.duplicate,
      headers: preview.headers,
      mappedFields: preview.mappedFields,
      missingFields: preview.missingFields,
      targetSheet: preview.targetSheet,
      unmappedFields: preview.unmappedFields,
      warnings: preview.warnings,
    });
  } catch (error) {
    return fail(error);
  }
}
