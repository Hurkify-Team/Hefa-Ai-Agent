import { ok, fail } from "@/lib/apiResponse";
import { logMemory } from "@/lib/memory";
import { getPortalFacilitySummary } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function GET() {
  try {
    logMemory("/api/portal/summary start");
    const summary = await getPortalFacilitySummary();
    logMemory("/api/portal/summary end");
    return ok(summary);
  } catch (error) {
    return fail(error, 500);
  }
}
