import { safeApi } from "@/lib/apiResponse";
import { buildRegistrationApprovedAnalytics } from "@/lib/portalWorkflow";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  return safeApi("/api/portal/registration-approved-analytics", async () => buildRegistrationApprovedAnalytics({
    endDate: url.searchParams.get("endDate"),
    month: url.searchParams.get("month"),
    startDate: url.searchParams.get("startDate"),
    year: url.searchParams.get("year"),
  }));
}
