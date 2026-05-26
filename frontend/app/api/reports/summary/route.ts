import { ok, fail } from "@/lib/apiResponse";
import { buildWorkbookReportSummary } from "@/lib/sheetAnalyzer";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok(await buildWorkbookReportSummary());
  } catch (error) {
    return fail(error);
  }
}
