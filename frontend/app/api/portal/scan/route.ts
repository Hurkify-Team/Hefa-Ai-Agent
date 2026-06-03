import { ok, fail } from "@/lib/apiResponse";
import { startPortalFacilityScan } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(startPortalFacilityScan());
  } catch (error) {
    return fail(error, 500);
  }
}
