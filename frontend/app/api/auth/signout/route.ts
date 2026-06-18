import { ok } from "@/lib/apiResponse";
import { clearAuthSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  const response = ok({ signedOut: true });
  clearAuthSessionCookie(response);
  return response;
}
