import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { ok, fail } from "@/lib/apiResponse";
import { searchFacility } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

const searchPortalSchema = z.object({
  facilityName: z.string().trim().min(1, "Facility name is required"),
});

export async function POST(request: Request) {
  try {
    const payload = searchPortalSchema.parse(await safeRequestJson(request, "app/api/portal/search/route.ts"));
    return ok(await searchFacility(payload));
  } catch (error) {
    return fail(error);
  }
}
