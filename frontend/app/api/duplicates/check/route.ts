import { ok, fail } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { checkDuplicateFacility } from "@/lib/duplicateChecker";
import { readExistingRecords } from "@/lib/googleSheets";
import { duplicateCheckSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = duplicateCheckSchema.parse(await request.json());
    const records = await readExistingRecords(payload.category);
    const result = checkDuplicateFacility(payload.values, records.rows);

    await logAuditEntry({
      user: "Admin User",
      actionType: "duplicate_check",
      category: payload.category,
      facilityName: String(payload.values["Facility Name"] ?? ""),
      status: result.status === "no_duplicate" ? "success" : "warning",
      details: result.status,
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
