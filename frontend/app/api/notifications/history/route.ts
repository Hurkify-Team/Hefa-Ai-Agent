import { fail, ok } from "@/lib/apiResponse";
import { logMemory } from "@/lib/memory";
import { listNotificationLogs } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    logMemory("/api/notifications/history start");
    const { searchParams } = new URL(request.url);
    const requestedLimit = Number(searchParams.get("limit") ?? 50);
    const limit = Math.max(1, Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 50, 500));
    const logs = listNotificationLogs({
        category: searchParams.get("category") || undefined,
        channel: searchParams.get("channel") || undefined,
        lga: searchParams.get("lga") || undefined,
        status: searchParams.get("status") || undefined,
      }).slice(0, limit);
    logMemory("/api/notifications/history end");
    return ok({ logs, limit });
  } catch (error) {
    return fail(error, 500);
  }
}
