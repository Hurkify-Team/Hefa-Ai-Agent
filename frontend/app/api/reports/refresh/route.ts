import { safeApi } from "@/lib/apiResponse";
import { assertGoogleSheetsConfigured } from "@/lib/googleSheets";
import { logMemory } from "@/lib/memory";
import { writeReportCache } from "@/lib/reportCache";
import { buildWorkbookReportSummary } from "@/lib/sheetAnalyzer";

export const runtime = "nodejs";

export async function POST() {
  return safeApi("/api/reports/refresh", async () => {
    logMemory("/api/reports/refresh start");
    assertGoogleSheetsConfigured();
    const summary = await buildWorkbookReportSummary();
    const cached = writeReportCache(summary, "manual-refresh");
    logMemory("/api/reports/refresh end");
    return {
      ...summary,
      cache: {
        expiresAt: cached.expiresAt,
        generatedAt: cached.generatedAt,
        source: cached.source,
      },
    };
  });
}
