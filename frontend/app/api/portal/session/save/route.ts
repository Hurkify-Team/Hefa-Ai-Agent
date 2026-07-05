import { ok, fail } from "@/lib/apiResponse";
import { savePortalSession } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(await savePortalSession());
  } catch (error) {
    return fail(error, 500);
  }
}
