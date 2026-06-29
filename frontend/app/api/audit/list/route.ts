import { ok, fail } from "@/lib/apiResponse";
import { listAuditEntries } from "@/lib/auditLog";

export const runtime = "nodejs";

export async function GET(request: Request) {
  console.info("[/api/audit/list] Dashboard audit list request started");
  try {
    const { searchParams } = new URL(request.url);
    const configuredLimit = Number(process.env.RECENT_ACTIVITY_LIMIT ?? 50);
    const requestedLimit = Number(searchParams.get("limit") ?? configuredLimit);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : configuredLimit, 50));
    const entries = await listAuditEntries(limit);
    console.info("[/api/audit/list] Dashboard audit list request completed", { entries: entries.length });
    return ok(entries);
  } catch (error) {
    console.error("[/api/audit/list] Dashboard audit list request failed", error);
    return fail(error, 500);
  }
}
