import { fail, ok } from "@/lib/apiResponse";
import { buildPortalCacheFreshnessPlan } from "@/lib/portalCacheFreshness";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit"));
    return ok(buildPortalCacheFreshnessPlan(Number.isInteger(limit) && limit > 0 ? limit : 150));
  } catch (error) {
    return fail(error, 500);
  }
}
