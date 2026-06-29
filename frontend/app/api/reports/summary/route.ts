import { safeApi } from "@/lib/apiResponse";
import { defaultReportCache, readReportCache } from "@/lib/reportCache";
import { logMemory } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET() {
  return safeApi("/api/reports/summary", async () => {
    logMemory("/api/reports/summary start");
    const cached = readReportCache() ?? defaultReportCache();
    logMemory("/api/reports/summary end");
    return {
      ...cached.summary,
      cache: {
        expiresAt: cached.expiresAt,
        generatedAt: cached.generatedAt,
        source: cached.source,
      },
    };
  });
}
