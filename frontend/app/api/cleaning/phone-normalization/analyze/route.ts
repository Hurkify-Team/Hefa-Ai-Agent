import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { analyzePhoneNormalization } from "@/lib/dataCleaning";

export const runtime = "nodejs";

const phoneNormalizationAnalyzeSchema = z.object({
  category: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = phoneNormalizationAnalyzeSchema.parse(await request.json().catch(() => ({})));
    return ok(await analyzePhoneNormalization(payload));
  } catch (error) {
    return fail(error);
  }
}
