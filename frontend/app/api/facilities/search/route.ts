import { ok, fail } from "@/lib/apiResponse";
import { searchFacilitiesAcrossSources } from "@/lib/sheetAnalyzer";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") ?? "";
    const category = searchParams.get("category") || undefined;

    return ok(await searchFacilitiesAcrossSources({ query, category }));
  } catch (error) {
    return fail(error);
  }
}
