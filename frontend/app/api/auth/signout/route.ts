import { ok, safeApi } from "@/lib/apiResponse";
import { clearAuthSessionCookie } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST() {
  return safeApi("/api/auth/signout", () => {
    const response = ok({ signedOut: true });
    clearAuthSessionCookie(response);
    return response;
  });
}
