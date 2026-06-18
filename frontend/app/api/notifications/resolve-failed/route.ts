import { fail, ok } from "@/lib/apiResponse";
import { resolveFailedNotificationLogs } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    return ok(resolveFailedNotificationLogs(body));
  } catch (error) {
    return fail(error, 400);
  }
}
