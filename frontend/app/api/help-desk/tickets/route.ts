import { safeApi } from "@/lib/apiResponse";
import { safeRequestJson } from "@/lib/safeJson";
import {
  createHelpDeskTicket,
  getHelpDeskSummary,
  helpDeskTicketSchema,
  helpDeskTicketUpdateSchema,
  listHelpDeskTickets,
  updateHelpDeskTicket,
} from "@/lib/helpDesk";

export const runtime = "nodejs";

function ticketPayload(extra: Record<string, unknown> = {}) {
  return { summary: getHelpDeskSummary(), tickets: listHelpDeskTickets(), ...extra };
}

export async function GET() {
  return safeApi("/api/help-desk/tickets", () => ticketPayload());
}

export async function POST(request: Request) {
  return safeApi("/api/help-desk/tickets", async () => {
    const body = await safeRequestJson(request, "app/api/help-desk/tickets/route.ts");
    const ticket = createHelpDeskTicket(helpDeskTicketSchema.parse(body));
    return ticketPayload({ ticket });
  }, 400);
}

export async function PATCH(request: Request) {
  return safeApi("/api/help-desk/tickets", async () => {
    const body = await safeRequestJson(request, "app/api/help-desk/tickets/route.ts");
    const ticket = updateHelpDeskTicket(helpDeskTicketUpdateSchema.parse(body));
    return ticketPayload({ ticket });
  }, 400);
}
