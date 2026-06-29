import { safeRequestJson } from "@/lib/safeJson";
import { ok, fail } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { createNewCategorySheet } from "@/lib/googleSheets";
import { createCategorySchema } from "@/lib/validators";
import { clearWorkbookSourceCache } from "@/lib/workbookSources";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = createCategorySchema.parse(await safeRequestJson(request, "app/api/sheets/create-sheet/route.ts"));
    const result = await createNewCategorySheet(payload);
    clearWorkbookSourceCache("active");

    await logAuditEntry({
      user: "Admin User",
      actionType: "category_created",
      category: payload.category,
      status: "success",
      details: `Created category with ${payload.headers.length} headers`,
    });

    return ok(result, 201);
  } catch (error) {
    return fail(error);
  }
}
