import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { analyzeDuplicateGroups } from "@/lib/duplicateReview";

export const runtime = "nodejs";

const duplicateGroupsSchema = z.object({
  category: z.string().trim().min(1).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = duplicateGroupsSchema.parse(await safeRequestJson(request, "app/api/duplicates/groups/route.ts", {}));
    return ok(await analyzeDuplicateGroups(payload));
  } catch (error) {
    return fail(error);
  }
}
