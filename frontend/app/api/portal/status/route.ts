import { ok, fail } from "@/lib/apiResponse";
import { getPortalSessionStatus } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await getPortalSessionStatus());
  } catch (error) {
    return fail(error, 500);
  }
}
