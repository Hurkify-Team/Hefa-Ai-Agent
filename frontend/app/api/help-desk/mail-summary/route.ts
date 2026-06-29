import { safeApi } from "@/lib/apiResponse";
import { getGmailConnectionStatus, getGmailSummary, listAgencyMailRecords } from "@/lib/gmailIntelligence";

export const runtime = "nodejs";

export async function GET() {
  return safeApi("/api/help-desk/mail-summary", () => ({
    gmail: getGmailConnectionStatus(),
    mailRecords: listAgencyMailRecords(),
    summary: getGmailSummary(),
  }));
}
