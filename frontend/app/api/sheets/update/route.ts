import { safeRequestJson } from "@/lib/safeJson";
import { ok, fail } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { updateExistingFacilityRow } from "@/lib/googleSheets";
import { updateRowSchema } from "@/lib/validators";
import { clearWorkbookSourceCache } from "@/lib/workbookSources";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = updateRowSchema.parse(await safeRequestJson(request, "app/api/sheets/update/route.ts"));
    const result = await updateExistingFacilityRow(
      payload.category,
      payload.rowIndex,
      payload.values,
      payload.confirmedFields,
    );
    clearWorkbookSourceCache("active");

    await logAuditEntry({
      user: payload.user,
      actionType: "update",
      category: payload.category,
      facilityName: String(payload.values["Facility Name"] ?? result.row["Facility Name"] ?? ""),
      affectedRow: result.rowIndex,
      missingFields: payload.missingFields,
      confidenceScore: payload.confidence,
      sourcePortalUrl: payload.sourcePortalUrl,
      status: "success",
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
