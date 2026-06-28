import { z } from "zod";

export const helpDeskTicketSchema = z.object({
  assignedUnit: z.string().optional().or(z.literal("")),
  channel: z.enum(["email", "letter", "walk_in", "phone", "portal"]),
  contactPhone: z.string().optional().or(z.literal("")),
  facilityName: z.string().optional().or(z.literal("")),
  message: z.string().min(3),
  senderEmail: z.string().email().optional().or(z.literal("")),
  senderName: z.string().min(1),
  subject: z.string().min(2),
});

export const helpDeskTicketUpdateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["open", "in_review", "resolved"]),
});

export type HelpDeskTicketInput = z.infer<typeof helpDeskTicketSchema>;
export type HelpDeskTicket = HelpDeskTicketInput & {
  assignedUnit: string;
  category: string;
  createdAt: string;
  dueAt: string;
  id: string;
  priority: "low" | "normal" | "high";
  resolutionNote?: string;
  resolvedAt?: string;
  slaHours: number;
  slaStatus: "on_track" | "due_soon" | "breached" | "resolved";
  status: "open" | "in_review" | "resolved";
  updatedAt: string;
};

type StoredTicket = Partial<HelpDeskTicket> & HelpDeskTicketInput & { id: string; createdAt: string };

type HelpDeskStore = {
  tickets: StoredTicket[];
};

const CATEGORY_RULES = [
  { category: "Complaint", keywords: ["complaint", "complain", "poor service", "delay", "harass", "fraud", "illegal", "unsafe"] },
  { category: "License Renewal", keywords: ["renewal", "renew", "annual", "license", "licence"] },
  { category: "Payment", keywords: ["payment", "receipt", "invoice", "remita", "bank"] },
  { category: "Inspection", keywords: ["inspection", "monitoring", "visit", "inspect"] },
  { category: "Registration", keywords: ["registration", "register", "new facility", "application"] },
  { category: "Portal Support", keywords: ["portal", "login", "password", "upload", "dashboard"] },
  { category: "Public Enquiry", keywords: ["enquiry", "inquiry", "question", "request", "information", "hefamaa number", "address"] },
];

const UNIT_BY_CATEGORY: Record<string, string> = {
  Complaint: "Compliance & Enforcement",
  "License Renewal": "Licensing Unit",
  Payment: "Accounts & Revenue",
  Inspection: "Monitoring & Inspection",
  Registration: "Facility Registry",
  "Portal Support": "ICT / Portal Support",
  "Public Enquiry": "Front Desk",
};

let memoryStore: HelpDeskStore | null = null;

function seedStore(): HelpDeskStore {
  return {
    tickets: [
      {
        assignedUnit: "ICT / Portal Support",
        category: "Portal Support",
        channel: "email",
        contactPhone: "",
        createdAt: new Date().toISOString(),
        dueAt: new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(),
        facilityName: "",
        id: "ticket-sample-portal",
        message: "Facility owner cannot upload payment evidence on the portal.",
        priority: "normal",
        senderEmail: "facility.owner@example.com",
        senderName: "Facility Owner",
        slaHours: 72,
        slaStatus: "on_track",
        status: "open",
        subject: "Portal upload issue",
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

function readStore(): HelpDeskStore {
  if (!memoryStore) memoryStore = seedStore();
  return { tickets: [...memoryStore.tickets] };
}

function writeStore(store: HelpDeskStore) {
  memoryStore = { tickets: [...store.tickets] };
}

export function categorizeHelpDeskText(text: string) {
  const value = text.toLowerCase();
  const match = CATEGORY_RULES.find((rule) => rule.keywords.some((keyword) => value.includes(keyword)));
  return match?.category ?? "Public Enquiry";
}

function inferPriority(text: string): HelpDeskTicket["priority"] {
  const value = text.toLowerCase();
  if (/urgent|emergency|threat|death|unsafe|illegal|fraud|harass|unregistered/.test(value)) return "high";
  if (/follow up|delay|pending|complaint|query|approval/.test(value)) return "normal";
  return "low";
}

function slaHoursFor(priority: HelpDeskTicket["priority"], category: string) {
  if (priority === "high") return 24;
  if (category === "Complaint" || category === "Inspection") return 48;
  if (priority === "normal") return 72;
  return 120;
}

function slaStatusFor(ticket: Pick<HelpDeskTicket, "dueAt" | "status">): HelpDeskTicket["slaStatus"] {
  if (ticket.status === "resolved") return "resolved";
  const dueTime = new Date(ticket.dueAt).getTime();
  if (!Number.isFinite(dueTime)) return "on_track";
  const remainingMs = dueTime - Date.now();
  if (remainingMs < 0) return "breached";
  if (remainingMs <= 24 * 60 * 60 * 1000) return "due_soon";
  return "on_track";
}

function hydrateTicket(ticket: StoredTicket): HelpDeskTicket {
  const text = (ticket.subject ?? "") + " " + (ticket.message ?? "");
  const category = ticket.category || categorizeHelpDeskText(text);
  const priority = ticket.priority || inferPriority(text);
  const slaHours = ticket.slaHours || slaHoursFor(priority, category);
  const createdAt = ticket.createdAt || new Date().toISOString();
  const dueAt = ticket.dueAt || new Date(new Date(createdAt).getTime() + slaHours * 60 * 60 * 1000).toISOString();
  const status = ticket.status || "open";
  const assignedUnit = ticket.assignedUnit || UNIT_BY_CATEGORY[category] || "Front Desk";

  return {
    assignedUnit,
    category,
    channel: ticket.channel || "walk_in",
    contactPhone: ticket.contactPhone || "",
    createdAt,
    dueAt,
    facilityName: ticket.facilityName || "",
    id: ticket.id,
    message: ticket.message || "",
    priority,
    resolutionNote: ticket.resolutionNote,
    resolvedAt: ticket.resolvedAt,
    senderEmail: ticket.senderEmail || "",
    senderName: ticket.senderName || "Unknown requester",
    slaHours,
    slaStatus: slaStatusFor({ dueAt, status }),
    status,
    subject: ticket.subject || "Untitled help desk case",
    updatedAt: ticket.updatedAt || createdAt,
  };
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<T, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {} as Record<T, number>);
}

function rankedCounts(values: string[]) {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

export function listHelpDeskTickets() {
  return readStore().tickets.map(hydrateTicket).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createHelpDeskTicket(input: HelpDeskTicketInput) {
  const cleanInput = helpDeskTicketSchema.parse(input);
  const store = readStore();
  const text = cleanInput.subject + " " + cleanInput.message;
  const category = categorizeHelpDeskText(text);
  const priority = inferPriority(text);
  const slaHours = slaHoursFor(priority, category);
  const now = new Date();
  const ticket: HelpDeskTicket = {
    ...cleanInput,
    assignedUnit: cleanInput.assignedUnit || UNIT_BY_CATEGORY[category] || "Front Desk",
    category,
    contactPhone: cleanInput.contactPhone || "",
    createdAt: now.toISOString(),
    dueAt: new Date(now.getTime() + slaHours * 60 * 60 * 1000).toISOString(),
    facilityName: cleanInput.facilityName || "",
    id: "ticket-" + Date.now().toString(36),
    priority,
    slaHours,
    slaStatus: "on_track",
    status: "open",
    updatedAt: now.toISOString(),
  };
  store.tickets.unshift(ticket);
  writeStore(store);
  return ticket;
}

export function updateHelpDeskTicket(input: z.infer<typeof helpDeskTicketUpdateSchema>) {
  const cleanInput = helpDeskTicketUpdateSchema.parse(input);
  const store = readStore();
  let updated: HelpDeskTicket | null = null;
  const now = new Date().toISOString();

  store.tickets = store.tickets.map((stored) => {
    if (stored.id !== cleanInput.id) return stored;
    const ticket = hydrateTicket(stored);
    updated = hydrateTicket({
      ...ticket,
      resolvedAt: cleanInput.status === "resolved" ? now : ticket.resolvedAt,
      status: cleanInput.status,
      updatedAt: now,
    });
    return updated;
  });

  if (!updated) throw new Error("Help desk ticket was not found.");
  writeStore(store);
  return updated;
}

export function getHelpDeskSummary() {
  const tickets = listHelpDeskTickets();
  const statusCounts = countBy(tickets.map((ticket) => ticket.status));
  const priorityCounts = countBy(tickets.map((ticket) => ticket.priority));
  const slaCounts = countBy(tickets.map((ticket) => ticket.slaStatus));

  return {
    breachedTickets: tickets.filter((ticket) => ticket.slaStatus === "breached").length,
    categoryCounts: rankedCounts(tickets.map((ticket) => ticket.category)),
    channelCounts: rankedCounts(tickets.map((ticket) => ticket.channel.replace("_", " "))),
    dueToday: tickets.filter((ticket) => ticket.slaStatus === "due_soon").length,
    highPriorityTickets: tickets.filter((ticket) => ticket.priority === "high" && ticket.status !== "resolved").length,
    openTickets: tickets.filter((ticket) => ticket.status !== "resolved").length,
    priorityCounts,
    resolvedTickets: tickets.filter((ticket) => ticket.status === "resolved").length,
    slaCounts,
    statusCounts,
    totalTickets: tickets.length,
    unitCounts: rankedCounts(tickets.map((ticket) => ticket.assignedUnit)),
  };
}
