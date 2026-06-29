import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { createPasswordResetToken } from "@/lib/auth";

export const runtime = "nodejs";

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export async function POST(request: Request) {
  try {
    const payload = forgotPasswordSchema.parse(await safeRequestJson(request, "app/api/auth/forgot-password/route.ts"));
    const reset = createPasswordResetToken(payload.email);
    return ok({
      email: reset.email,
      expiresAt: reset.expiresAt,
      resetCode: reset.token,
      note: "Local MVP reset code generated. Email delivery can be connected later.",
    });
  } catch (error) {
    return fail(error, 400);
  }
}
