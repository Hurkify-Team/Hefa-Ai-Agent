import { ok, fail } from "@/lib/apiResponse";
import { logMemory } from "@/lib/memory";
import { openPortal } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    logMemory("/api/portal/open start");
    const result = await openPortal();
    logMemory("/api/portal/open end");
    return ok(result);
  } catch (error) {
    return fail(error, 500);
  }
}
