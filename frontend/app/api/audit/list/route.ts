import { ok, fail } from "@/lib/apiResponse";
import { listAuditEntries } from "@/lib/auditLog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 100);
    return ok(await listAuditEntries(Number.isFinite(limit) ? limit : 100));
  } catch (error) {
    return fail(error, 500);
  }
}
