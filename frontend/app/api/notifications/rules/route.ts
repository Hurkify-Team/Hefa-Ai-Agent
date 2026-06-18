import { fail, ok } from "@/lib/apiResponse";
import { listNotificationRules } from "@/lib/notificationRules";
import { upsertNotificationRule } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function GET() {
  try {
    return ok({ rules: listNotificationRules() });
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    return ok({ rule: upsertNotificationRule(await request.json()) });
  } catch (error) {
    return fail(error);
  }
}
