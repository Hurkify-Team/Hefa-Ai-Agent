import { safeRequestJson } from "@/lib/safeJson";
import { fail, ok } from "@/lib/apiResponse";
import { previewNotifications } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return ok(previewNotifications(await safeRequestJson(request, "app/api/notifications/preview/route.ts")));
  } catch (error) {
    return fail(error);
  }
}
