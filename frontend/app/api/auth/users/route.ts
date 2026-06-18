import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { createAuthUser, deleteAuthUser, listAuthUsers, requireCurrentUserFromRequest, updateAuthUser } from "@/lib/auth";
import { canManageUsers } from "@/lib/authAccess";
import { teamRoles } from "@/lib/authAccess";

export const runtime = "nodejs";

const createUserSchema = z.object({
  department: z.string().trim().optional(),
  email: z.string().email(),
  name: z.string().trim().min(2),
  password: z.string().min(8),
  role: z.enum(teamRoles as [typeof teamRoles[number], ...typeof teamRoles[number][]]).optional(),
});

const patchUserSchema = z.object({
  department: z.string().trim().optional(),
  id: z.string().min(1),
  name: z.string().trim().min(2).optional(),
  role: z.enum(teamRoles as [typeof teamRoles[number], ...typeof teamRoles[number][]]).optional(),
  status: z.enum(["active", "paused"]).optional(),
});

const deleteUserSchema = z.object({
  id: z.string().min(1),
});

export async function GET(request: Request) {
  try {
    const actor = requireCurrentUserFromRequest(request);
    if (!canManageUsers(actor.role)) throw new Error("You do not have permission to manage users.");
    return ok({ users: listAuthUsers() });
  } catch (error) {
    return fail(error, 403);
  }
}

export async function POST(request: Request) {
  try {
    const actor = requireCurrentUserFromRequest(request);
    if (!canManageUsers(actor.role)) throw new Error("You do not have permission to manage users.");
    const payload = createUserSchema.parse(await request.json());
    const user = createAuthUser({ ...payload, status: "active" });
    return ok({ user, users: listAuthUsers() }, 201);
  } catch (error) {
    return fail(error, 400);
  }
}

export async function PATCH(request: Request) {
  try {
    const actor = requireCurrentUserFromRequest(request);
    const payload = patchUserSchema.parse(await request.json());
    const user = updateAuthUser(actor, payload.id, payload);
    return ok({ user, users: listAuthUsers() });
  } catch (error) {
    return fail(error, 400);
  }
}

export async function DELETE(request: Request) {
  try {
    const actor = requireCurrentUserFromRequest(request);
    const payload = deleteUserSchema.parse(await request.json());
    deleteAuthUser(actor, payload.id);
    return ok({ users: listAuthUsers() });
  } catch (error) {
    return fail(error, 400);
  }
}
