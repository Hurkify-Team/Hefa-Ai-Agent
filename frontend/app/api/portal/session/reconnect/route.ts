import { ok, fail } from "@/lib/apiResponse";
import { reconnectPortalSession } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(await reconnectPortalSession());
  } catch (error) {
    return fail(error, 500);
  }
}
