import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { analyzeSerialNumbering } from "@/lib/dataCleaning";

export const runtime = "nodejs";

const serialNumberAnalyzeSchema = z.object({
  category: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  try {
    const payload = serialNumberAnalyzeSchema.parse(await request.json().catch(() => ({})));
    return ok(await analyzeSerialNumbering(payload));
  } catch (error) {
    return fail(error);
  }
}
