import { ok, fail } from "@/lib/apiResponse";
import { clearPortalSession } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(await clearPortalSession());
  } catch (error) {
    return fail(error, 500);
  }
}
