import { safeRequestJson } from "@/lib/safeJson";
import { fail, ok } from "@/lib/apiResponse";
import { resolveFailedNotificationLogs } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await safeRequestJson(request, "app/api/notifications/resolve-failed/route.ts", {});
    return ok(resolveFailedNotificationLogs(body));
  } catch (error) {
    return fail(error, 400);
  }
}
