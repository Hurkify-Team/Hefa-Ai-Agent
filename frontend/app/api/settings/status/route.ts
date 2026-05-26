import { ok, fail } from "@/lib/apiResponse";
import { getSettingsStatus } from "@/lib/settingsStatus";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await getSettingsStatus());
  } catch (error) {
    return fail(error, 500);
  }
}
