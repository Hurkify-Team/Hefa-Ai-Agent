import { ok, fail } from "@/lib/apiResponse";
import { readSheetTabs } from "@/lib/googleSheets";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await readSheetTabs());
  } catch (error) {
    return fail(error, 500);
  }
}
