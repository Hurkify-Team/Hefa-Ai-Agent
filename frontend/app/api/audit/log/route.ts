import { ok, fail } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { auditLogSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = auditLogSchema.parse(await request.json());
    return ok(await logAuditEntry(payload), 201);
  } catch (error) {
    return fail(error);
  }
}
