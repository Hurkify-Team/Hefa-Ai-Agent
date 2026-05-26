import { ok, fail } from "@/lib/apiResponse";
import { openPortal } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(await openPortal());
  } catch (error) {
    return fail(error, 500);
  }
}
