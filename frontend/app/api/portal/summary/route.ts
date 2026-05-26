import { ok, fail } from "@/lib/apiResponse";
import { getPortalFacilitySummary } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await getPortalFacilitySummary());
  } catch (error) {
    return fail(error, 500);
  }
}
