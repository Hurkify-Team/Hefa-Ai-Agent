import { safeApi } from "@/lib/apiResponse";
import { assertGoogleSheetsConfigured, clearSheetDataCache, readSheetTabs } from "@/lib/googleSheets";
import { logMemory } from "@/lib/memory";

export const runtime = "nodejs";

export async function POST() {
  return safeApi("/api/sheets/sync", async () => {
    logMemory("/api/sheets/sync start");
    assertGoogleSheetsConfigured();
    clearSheetDataCache();
    const tabs = await readSheetTabs();
    logMemory("/api/sheets/sync end");
    return {
      synced: true,
      tabCount: tabs.length,
      tabs,
    };
  });
}
