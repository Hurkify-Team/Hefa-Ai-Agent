import { ok, fail } from "@/lib/apiResponse";
import { listAuditEntries } from "@/lib/auditLog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  console.info("[/api/audit/list] Dashboard audit list request started");
  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") ?? 100);
    const entries = await listAuditEntries(Number.isFinite(limit) ? limit : 100);
    console.info("[/api/audit/list] Dashboard audit list request completed", { entries: entries.length });
    return ok(entries);
  } catch (error) {
    console.error("[/api/audit/list] Dashboard audit list request failed", error);
    return fail(error, 500);
  }
}
