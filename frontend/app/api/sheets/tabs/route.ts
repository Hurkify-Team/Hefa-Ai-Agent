import { ok, fail } from "@/lib/apiResponse";
import { readSheetTabs } from "@/lib/googleSheets";

export const runtime = "nodejs";

export async function GET() {
  console.info("[/api/sheets/tabs] Dashboard sheet tabs request started");
  try {
    const tabs = await readSheetTabs();
    console.info("[/api/sheets/tabs] Dashboard sheet tabs request completed", { tabs: tabs.length });
    return ok(tabs);
  } catch (error) {
    console.error("[/api/sheets/tabs] Dashboard sheet tabs request failed", error);
    return fail(error, 500);
  }
}
