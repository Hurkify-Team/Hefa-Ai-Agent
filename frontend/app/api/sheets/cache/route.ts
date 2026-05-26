import { fail, ok } from "@/lib/apiResponse";
import { clearSheetDataCache, getSheetCacheStatus } from "@/lib/googleSheets";
import { clearWorkbookSourceCache } from "@/lib/workbookSources";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(getSheetCacheStatus());
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST() {
  try {
    clearSheetDataCache();
    clearWorkbookSourceCache();
    return ok({ cleared: true, clearedAt: new Date().toISOString() });
  } catch (error) {
    return fail(error, 500);
  }
}
