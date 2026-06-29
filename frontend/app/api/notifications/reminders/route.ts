import { safeRequestJson } from "@/lib/safeJson";
import { fail, ok } from "@/lib/apiResponse";
import { MAX_NOTIFICATION_RECIPIENTS, listNotificationStatusFacilities, runDailyNotificationScan } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("list") === "facilities") {
      return ok(listNotificationStatusFacilities({
        category: url.searchParams.get("category") || "",
        dueOnly: url.searchParams.get("dueOnly") || "false",
        facilityQuery: url.searchParams.get("facilityQuery") || "",
        lga: url.searchParams.get("lga") || "",
        limit: url.searchParams.get("limit") || MAX_NOTIFICATION_RECIPIENTS,
        owner: url.searchParams.get("owner") || "all",
        status: url.searchParams.get("status") || "",
      }));
    }
    return ok(await runDailyNotificationScan({ channels: ["email", "sms"], limit: 100 }));
  } catch (error) {
    return fail(error, 500);
  }
}

export async function POST(request: Request) {
  try {
    const payload = await safeRequestJson(request, "app/api/notifications/reminders/route.ts", {});
    return ok(await runDailyNotificationScan({ channels: ["email", "sms"], limit: MAX_NOTIFICATION_RECIPIENTS, ...payload }));
  } catch (error) {
    return fail(error);
  }
}
