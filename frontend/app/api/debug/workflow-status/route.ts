import { safeApi } from "@/lib/apiResponse";
import { buildPortalWorkflowDiagnostics } from "@/lib/portalWorkflow";

export const runtime = "nodejs";

export async function GET() {
  return safeApi("/api/debug/workflow-status", async () => buildPortalWorkflowDiagnostics());
}
