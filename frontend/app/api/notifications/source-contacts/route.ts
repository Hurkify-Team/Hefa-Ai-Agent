import { safeRequestJson } from "@/lib/safeJson";
import { fail, ok } from "@/lib/apiResponse";
import { sourceMissingNotificationContacts } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await safeRequestJson(request, "app/api/notifications/source-contacts/route.ts", {});
    return ok(await sourceMissingNotificationContacts(body));
  } catch (error) {
    return fail(error, 500);
  }
}
