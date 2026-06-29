import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { analyzeSerialNumbering } from "@/lib/dataCleaning";

export const runtime = "nodejs";

const serialNumberAnalyzeSchema = z.object({
  category: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = serialNumberAnalyzeSchema.parse(await safeRequestJson(request, "app/api/cleaning/serial-numbers/analyze/route.ts", {}));
    return ok(await analyzeSerialNumbering(payload));
  } catch (error) {
    return fail(error);
  }
}
