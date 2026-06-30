import { ok, fail } from "@/lib/apiResponse";
import { logMemory } from "@/lib/memory";
import { getFastPortalFacilitySummary, getPortalFacilitySummary } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const full = searchParams.get("full") === "1" || searchParams.get("full") === "true";
    logMemory(full ? "/api/portal/summary full start" : "/api/portal/summary fast start");
    const summary = full ? await getPortalFacilitySummary() : getFastPortalFacilitySummary();
    logMemory(full ? "/api/portal/summary full end" : "/api/portal/summary fast end");
    return ok(summary);
  } catch (error) {
    return fail(error, 500);
  }
}
