import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { analyzeDataQuality } from "@/lib/dataCleaning";

export const runtime = "nodejs";

const dataQualityAnalyzeSchema = z.object({
  category: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = dataQualityAnalyzeSchema.parse(await request.json().catch(() => ({})));
    return ok(await analyzeDataQuality(payload));
  } catch (error) {
    return fail(error);
  }
}
