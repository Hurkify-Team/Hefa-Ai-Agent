import { fail, ok } from "@/lib/apiResponse";
import { listNotificationLogs } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    return ok({
      logs: listNotificationLogs({
        category: searchParams.get("category") || undefined,
        channel: searchParams.get("channel") || undefined,
        lga: searchParams.get("lga") || undefined,
        status: searchParams.get("status") || undefined,
      }),
    });
  } catch (error) {
    return fail(error, 500);
  }
}
