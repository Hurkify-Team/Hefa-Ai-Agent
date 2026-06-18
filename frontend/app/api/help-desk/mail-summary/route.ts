import { NextResponse } from "next/server";
import { getGmailConnectionStatus, getGmailSummary, listAgencyMailRecords } from "@/lib/gmailIntelligence";

export async function GET() {
  return NextResponse.json({
    ok: true,
    data: {
      gmail: getGmailConnectionStatus(),
      mailRecords: listAgencyMailRecords(),
      summary: getGmailSummary(),
    },
  });
}
