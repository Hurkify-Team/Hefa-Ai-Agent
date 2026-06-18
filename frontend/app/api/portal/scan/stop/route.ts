import { fail, ok } from "@/lib/apiResponse";
import { stopPortalFacilityScan } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(await stopPortalFacilityScan());
  } catch (error) {
    return fail(error, 500);
  }
}
