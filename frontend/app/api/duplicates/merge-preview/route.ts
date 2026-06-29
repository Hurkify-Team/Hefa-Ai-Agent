import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { buildDuplicateMergePlan } from "@/lib/duplicateReview";

export const runtime = "nodejs";

const mergePreviewSchema = z.object({
  groupId: z.string().trim().min(1),
  keeperCategory: z.string().trim().min(1),
  keeperRowIndex: z.number().int().min(0),
  category: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = mergePreviewSchema.parse(await safeRequestJson(request, "app/api/duplicates/merge-preview/route.ts"));
    return ok(await buildDuplicateMergePlan(payload));
  } catch (error) {
    return fail(error);
  }
}
