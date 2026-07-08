import { safeRequestJson } from "@/lib/safeJson";
import { ok, fail } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { addPreparedFacilityRow, clearSheetDataCache, prepareNewFacilityRow, readExistingRecords } from "@/lib/googleSheets";
import { checkDuplicateFacility } from "@/lib/duplicateChecker";
import { normalizeHeaderName } from "@/lib/normalizers";
import { appendRowSchema } from "@/lib/validators";
import { clearWorkbookSourceCache } from "@/lib/workbookSources";
import type { SheetRow } from "@/types/sheet";

export const runtime = "nodejs";

function facilityNameFromRow(values: SheetRow) {
  for (const [header, value] of Object.entries(values)) {
    const normalizedHeader = normalizeHeaderName(header);

    if (
      normalizedHeader === "facility name" ||
      normalizedHeader === "name" ||
      normalizedHeader.includes("facility name") ||
      normalizedHeader.includes("name of facility")
    ) {
      const text = String(value ?? "").trim();

      if (text) {
        return text;
      }
    }
  }

  return "";
}

export async function POST(request: Request) {
  try {
    const payload = appendRowSchema.parse(await safeRequestJson(request, "app/api/sheets/append/route.ts"));
    const prepared = await prepareNewFacilityRow(payload.category, payload.values);
    const facilityName = facilityNameFromRow(prepared.row);

    if (!facilityName) {
      throw new Error("Facility name is required before saving a new facility");
    }

    if (payload.dryRun) {
      return ok({
        dryRun: true,
        category: prepared.category,
        headers: prepared.headers,
        row: prepared.row,
        autoSerial: prepared.autoSerial,
      });
    }

    if (!payload.saveAnyway) {
      clearSheetDataCache();
      const existing = await readExistingRecords(prepared.category);
      const duplicate = checkDuplicateFacility(prepared.row, existing.rows);

      if (duplicate.status !== "no_duplicate") {
        const bestMatch = duplicate.matches[0];
        return ok({
          duplicateBlocked: true,
          category: prepared.category,
          status: duplicate.status,
          matches: duplicate.matches,
          rowIndex: bestMatch?.rowIndex ?? 0,
          row: bestMatch?.row ?? prepared.row,
          autoSerial: prepared.autoSerial,
          message: "Duplicate facility detected. Review the existing row before choosing Save Anyway.",
        });
      }
    }

    const result = await addPreparedFacilityRow(prepared);
    clearSheetDataCache();
    clearWorkbookSourceCache("active");

    await logAuditEntry({
      user: payload.user,
      actionType: "add",
      category: payload.category,
      facilityName,
      affectedRow: result.rowIndex,
      missingFields: payload.missingFields,
      confidenceScore: payload.confidence,
      sourcePortalUrl: payload.sourcePortalUrl,
      status: payload.saveAnyway ? "warning" : "success",
      details: [payload.saveAnyway ? "Saved anyway after duplicate warning" : "", result.autoSerial ? "Auto-filled " + result.autoSerial.header + " as " + result.autoSerial.value : ""].filter(Boolean).join(". ") || undefined,
    });

    return ok(result, 201);
  } catch (error) {
    return fail(error);
  }
}
