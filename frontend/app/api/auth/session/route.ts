import { ok, safeApi } from "@/lib/apiResponse";
import { rolePermissions, roleRouteAccess } from "@/lib/authAccess";
import { getCurrentUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return safeApi("/api/auth/session", () => {
    const user = getCurrentUserFromRequest(request);
    if (!user) {
      return ok({ authenticated: false, permissions: [], routeAccess: [] });
    }

    return ok({
      authenticated: true,
      permissions: rolePermissions[user.role] ?? [],
      routeAccess: roleRouteAccess[user.role] ?? [],
      user,
    });
  });
}
