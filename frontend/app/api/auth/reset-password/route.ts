import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { resetAuthUserPassword } from "@/lib/auth";

export const runtime = "nodejs";

const resetPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  resetCode: z.string().trim().min(12),
});

export async function POST(request: Request) {
  try {
    const payload = resetPasswordSchema.parse(await request.json());
    const user = resetAuthUserPassword(payload.email, payload.resetCode, payload.password);
    return ok({ reset: true, user });
  } catch (error) {
    return fail(error, 400);
  }
}
