import { fail, ok } from "@/lib/apiResponse";
import { listNotificationTemplates } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok({ templates: listNotificationTemplates() });
  } catch (error) {
    return fail(error, 500);
  }
}
