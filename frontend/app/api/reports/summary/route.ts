import { ok, fail } from "@/lib/apiResponse";
import { buildWorkbookReportSummary } from "@/lib/sheetAnalyzer";

export const runtime = "nodejs";

export async function GET() {
  console.info("[/api/reports/summary] Dashboard summary request started");
  try {
    const summary = await buildWorkbookReportSummary();
    console.info("[/api/reports/summary] Dashboard summary request completed", {
      totalFacilities: summary.totalFacilities,
      totalCategories: summary.totalCategories,
    });
    return ok(summary);
  } catch (error) {
    console.error("[/api/reports/summary] Dashboard summary request failed", error);
    return fail(error, 500);
  }
}
