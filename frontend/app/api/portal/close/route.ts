import { ok, fail } from "@/lib/apiResponse";
import { closePortal } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    return ok(await closePortal());
  } catch (error) {
    return fail(error, 500);
  }
}
