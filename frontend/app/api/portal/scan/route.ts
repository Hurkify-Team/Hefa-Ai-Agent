import { ok, fail } from "@/lib/apiResponse";
import { scanAllPortalFacilities } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(await scanAllPortalFacilities());
  } catch (error) {
    return fail(error, 500);
  }
}
