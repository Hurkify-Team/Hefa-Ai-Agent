import { safeRequestJson } from "@/lib/safeJson";
import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { createAuthUser, setAuthSessionCookie } from "@/lib/auth";
import { rolePermissions, roleRouteAccess, teamRoles } from "@/lib/authAccess";

export const runtime = "nodejs";

const signupSchema = z.object({
  department: z.string().trim().optional(),
  email: z.string().trim().email("Enter a valid email address."),
  name: z.string().trim().min(2, "Enter your full name."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  role: z.enum(teamRoles as [typeof teamRoles[number], ...typeof teamRoles[number][]]).default("Super User"),
});

export async function POST(request: Request) {
  try {
    const payload = signupSchema.parse(await safeRequestJson(request, "app/api/auth/signup/route.ts"));
    const user = createAuthUser(payload);
    const response = ok({
      authenticated: true,
      permissions: rolePermissions[user.role] ?? [],
      routeAccess: roleRouteAccess[user.role] ?? [],
      user,
    }, 201);
    setAuthSessionCookie(response, user);
    return response;
  } catch (error) {
    return fail(error, 400);
  }
}
