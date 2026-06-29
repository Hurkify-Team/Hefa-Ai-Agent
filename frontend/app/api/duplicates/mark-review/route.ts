import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { markDuplicateGroupForReview } from "@/lib/duplicateReview";
import { clearWorkbookSourceCache } from "@/lib/workbookSources";

export const runtime = "nodejs";

const markDuplicateReviewSchema = z.object({
  groupId: z.string().trim().min(1),
  category: z.string().trim().min(1).optional(),
  user: z.string().trim().min(1).default("Admin User"),
});

export async function POST(request: Request) {
  try {
    const payload = markDuplicateReviewSchema.parse(await safeRequestJson(request, "app/api/duplicates/mark-review/route.ts"));
    const result = await markDuplicateGroupForReview({ groupId: payload.groupId, category: payload.category });
    clearWorkbookSourceCache("active");

    await logAuditEntry({
      user: payload.user,
      actionType: "duplicate_check",
      category: payload.category ?? "ALL CATEGORIES",
      status: result.updatedCells ? "warning" : "failed",
      details:
        "Marked duplicate review group " +
        result.group.label +
        " (" +
        result.group.key +
        ") across " +
        result.updatedCells +
        " cells.",
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
