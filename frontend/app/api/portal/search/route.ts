import { z } from "zod";

import { ok, fail } from "@/lib/apiResponse";
import { searchFacility } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

const searchPortalSchema = z.object({
  facilityName: z.string().trim().min(1, "Facility name is required"),
});

export async function POST(request: Request) {
  try {
    const payload = searchPortalSchema.parse(await request.json());
    return ok(await searchFacility(payload));
  } catch (error) {
    return fail(error);
  }
}
