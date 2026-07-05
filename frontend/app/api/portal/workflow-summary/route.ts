import { safeApi } from "@/lib/apiResponse";
import { buildPortalWorkflowSummary } from "@/lib/portalWorkflow";

export const runtime = "nodejs";

export async function GET() {
  return safeApi("/api/portal/workflow-summary", async () => buildPortalWorkflowSummary());
}
