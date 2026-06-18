import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { authenticateAuthUser, setAuthSessionCookie } from "@/lib/auth";
import { rolePermissions, roleRouteAccess } from "@/lib/authAccess";

export const runtime = "nodejs";

const signinSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = signinSchema.parse(await request.json());
    const user = authenticateAuthUser(payload.email, payload.password);
    const response = ok({
      authenticated: true,
      permissions: rolePermissions[user.role] ?? [],
      routeAccess: roleRouteAccess[user.role] ?? [],
      user,
    });
    setAuthSessionCookie(response, user);
    return response;
  } catch (error) {
    return fail(error, 401);
  }
}
