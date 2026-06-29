import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { ok, fail } from "@/lib/apiResponse";
import { releasePortalProfileLock } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

const releaseLockSchema = z.object({
  force: z.boolean().default(false),
});

export async function POST(request: Request) {
  try {
    const payload = releaseLockSchema.parse(await safeRequestJson(request, "app/api/portal/release-lock/route.ts", {}));
    return ok(await releasePortalProfileLock({ force: payload.force }));
  } catch (error) {
    return fail(error, 500);
  }
}
