import { safeApi } from "@/lib/apiResponse";
import { logMemory } from "@/lib/memory";
import { searchFacilitiesAcrossSources } from "@/lib/sheetAnalyzer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return safeApi("/api/facilities/search", async () => {
    logMemory("/api/facilities/search start");
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") ?? "";
    const category = searchParams.get("category") || undefined;
    const requestedLimit = Number(searchParams.get("limit") ?? 75);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 75, 100));
    const results = await searchFacilitiesAcrossSources({ query, category, limit });
    logMemory("/api/facilities/search end");
    return results;
  });
}
