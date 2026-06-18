import { fail, ok } from "@/lib/apiResponse";
import { previewNotifications } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return ok(previewNotifications(await request.json()));
  } catch (error) {
    return fail(error);
  }
}
