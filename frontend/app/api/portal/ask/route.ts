import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { answerPortalQuestion } from "@/lib/portalIntelligence";

export const runtime = "nodejs";

const askSchema = z.object({
  question: z.string().trim().min(1, "Question is required"),
});

export async function POST(request: Request) {
  try {
    const payload = askSchema.parse(await safeRequestJson(request, "app/api/portal/ask/route.ts"));
    return ok(answerPortalQuestion(payload.question));
  } catch (error) {
    return fail(error);
  }
}
