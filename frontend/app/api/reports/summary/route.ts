import { safeApi } from "@/lib/apiResponse";
import { assertGoogleSheetsConfigured } from "@/lib/googleSheets";
import { buildWorkbookReportSummary } from "@/lib/sheetAnalyzer";

export const runtime = "nodejs";

export async function GET() {
  return safeApi("/api/reports/summary", async () => {
    assertGoogleSheetsConfigured();
    const summary = await buildWorkbookReportSummary();
    console.info("[/api/reports/summary] Dashboard summary generated", {
      totalFacilities: summary.totalFacilities,
      totalCategories: summary.totalCategories,
    });
    return summary;
  });
}
