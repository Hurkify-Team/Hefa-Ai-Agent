import { safeRequestJson } from "@/lib/safeJson";
import { NextResponse } from "next/server";
import {
  createHelpDeskTicket,
  getHelpDeskSummary,
  helpDeskTicketSchema,
  helpDeskTicketUpdateSchema,
  listHelpDeskTickets,
  updateHelpDeskTicket,
} from "@/lib/helpDesk";

export async function GET() {
  return NextResponse.json({ ok: true, data: { summary: getHelpDeskSummary(), tickets: listHelpDeskTickets() } });
}

export async function POST(request: Request) {
  try {
    const body = await safeRequestJson(request, "app/api/help-desk/tickets/route.ts");
    const ticket = createHelpDeskTicket(helpDeskTicketSchema.parse(body));
    return NextResponse.json({ ok: true, data: { summary: getHelpDeskSummary(), ticket, tickets: listHelpDeskTickets() } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to create help desk ticket." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await safeRequestJson(request, "app/api/help-desk/tickets/route.ts");
    const ticket = updateHelpDeskTicket(helpDeskTicketUpdateSchema.parse(body));
    return NextResponse.json({ ok: true, data: { summary: getHelpDeskSummary(), ticket, tickets: listHelpDeskTickets() } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Unable to update help desk ticket." }, { status: 400 });
  }
}
