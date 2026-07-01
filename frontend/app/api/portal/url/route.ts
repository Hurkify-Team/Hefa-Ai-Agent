import { fail, ok } from "@/lib/apiResponse";
import { getConfiguredPortalUrl } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok({ url: getConfiguredPortalUrl() });
  } catch (error) {
    return fail(error, 500);
  }
}
