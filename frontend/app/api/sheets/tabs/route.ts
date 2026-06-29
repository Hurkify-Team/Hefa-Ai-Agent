import { safeApi } from "@/lib/apiResponse";
import { assertGoogleSheetsConfigured, readSheetTabs } from "@/lib/googleSheets";

export const runtime = "nodejs";

export async function GET() {
  return safeApi("/api/sheets/tabs", async () => {
    assertGoogleSheetsConfigured();
    const tabs = await readSheetTabs();
    console.info("[/api/sheets/tabs] Sheet tabs loaded", { tabs: tabs.length });
    return tabs;
  });
}
