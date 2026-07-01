import { fail, ok } from "@/lib/apiResponse";
import { getPortalSessionManagerStatus } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await getPortalSessionManagerStatus());
  } catch (error) {
    return fail(error, 500);
  }
}
