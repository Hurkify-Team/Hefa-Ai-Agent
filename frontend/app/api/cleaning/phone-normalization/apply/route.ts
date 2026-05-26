import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { applyPhoneNormalizationFixes } from "@/lib/dataCleaning";
import { clearWorkbookSourceCache } from "@/lib/workbookSources";

export const runtime = "nodejs";

const phoneNormalizationApplySchema = z.object({
  category: z.string().trim().min(1).optional(),
  user: z.string().trim().min(1).default("Admin User"),
});

export async function POST(request: Request) {
  try {
    const payload = phoneNormalizationApplySchema.parse(await request.json().catch(() => ({})));
    const result = await applyPhoneNormalizationFixes({ category: payload.category });
    clearWorkbookSourceCache("active");

    await logAuditEntry({
      user: payload.user,
      actionType: "cleaning",
      category: payload.category ?? "ALL CATEGORIES",
      status: result.updatedCells ? "success" : "warning",
      details:
        "Normalized phone/contact values: " +
        result.updatedCells +
        " cells updated across " +
        result.categories.filter((category) => category.issueCount > 0).length +
        " categories.",
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
