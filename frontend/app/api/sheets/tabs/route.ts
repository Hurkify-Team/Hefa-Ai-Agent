import { safeApi } from "@/lib/apiResponse";
import { assertGoogleSheetsConfigured, readSheetTabs } from "@/lib/googleSheets";
import { logMemory } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET() {
  return safeApi("/api/sheets/tabs", async () => {
    logMemory("/api/sheets/tabs start");
    assertGoogleSheetsConfigured();
    const tabs = await readSheetTabs();
    logMemory("/api/sheets/tabs end");
    console.info("[/api/sheets/tabs] Sheet tabs loaded", { tabs: tabs.length });
    return tabs;
  });
}
