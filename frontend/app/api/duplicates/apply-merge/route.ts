import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { applyDuplicateMerge } from "@/lib/duplicateReview";
import { clearWorkbookSourceCache } from "@/lib/workbookSources";

export const runtime = "nodejs";

const applyMergeSchema = z.object({
  groupId: z.string().trim().min(1),
  keeperCategory: z.string().trim().min(1),
  keeperRowIndex: z.number().int().min(0),
  selectedFields: z.array(z.string().trim().min(1)).min(1),
  category: z.string().trim().min(1).optional(),
  user: z.string().trim().min(1).default("Admin User"),
});

export async function POST(request: Request) {
  try {
    const payload = applyMergeSchema.parse(await request.json());
    const result = await applyDuplicateMerge(payload);
    clearWorkbookSourceCache("active");

    await logAuditEntry({
      user: payload.user,
      actionType: "update",
      category: result.plan.keeper.category,
      facilityName: result.plan.keeper.facilityName,
      affectedRow: result.plan.keeper.sheetRowNumber,
      status: result.updatedCells ? "success" : "warning",
      details:
        "Applied duplicate merge suggestions for " +
        result.plan.group.label +
        " (" +
        result.plan.group.key +
        ") across " +
        result.updatedCells +
        " selected fields.",
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
