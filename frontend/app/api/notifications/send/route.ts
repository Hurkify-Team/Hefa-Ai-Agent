import { fail, ok } from "@/lib/apiResponse";
import { sendNotifications } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    return ok(await sendNotifications(await request.json()));
  } catch (error) {
    return fail(error);
  }
}
