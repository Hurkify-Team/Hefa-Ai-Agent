import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { ok, fail } from "@/lib/apiResponse";
import { resolveLegacyFallback } from "@/lib/facilityResolver";

export const runtime = "nodejs";

const legacyResolveSchema = z.object({
  category: z.string().trim().min(1),
  headers: z.array(z.string().trim().min(1)).min(1),
  values: z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
});

export async function POST(request: Request) {
  try {
    const payload = legacyResolveSchema.parse(await safeRequestJson(request, "app/api/legacy/resolve/route.ts"));
    return ok(await resolveLegacyFallback(payload));
  } catch (error) {
    return fail(error);
  }
}
