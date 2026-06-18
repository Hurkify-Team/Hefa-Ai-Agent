import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

export type AgencyMailRecord = {
  category: string;
  from: string;
  id: string;
  receivedAt: string;
  snippet: string;
  source: "gmail" | "sample";
  subject: string;
};

type GmailStore = {
  mailRecords: AgencyMailRecord[];
};

const MAIL_CATEGORY_RULES = [
  { category: "Complaint", keywords: ["complaint", "illegal", "unsafe", "unregistered", "poor service"] },
  { category: "Renewal Support", keywords: ["renewal", "renew", "licence", "license", "annual"] },
  { category: "Payment", keywords: ["payment", "receipt", "invoice", "remita"] },
  { category: "Inspection", keywords: ["inspection", "monitoring", "report"] },
  { category: "Portal Support", keywords: ["portal", "login", "password", "upload"] },
  { category: "General Correspondence", keywords: ["letter", "request", "information", "meeting"] },
];

function gmailPath() {
  const configured = process.env.GMAIL_DATA_PATH?.trim() || "data/gmail-intelligence-records.json";
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function seedStore(): GmailStore {
  return {
    mailRecords: [
      {
        category: "Complaint",
        from: "resident@example.com",
        id: "mail-sample-complaint",
        receivedAt: new Date().toISOString(),
        snippet: "Complaint about an unregistered facility operating in the area.",
        source: "sample",
        subject: "Complaint about facility operation",
      },
      {
        category: "Renewal Support",
        from: "clinic@example.com",
        id: "mail-sample-renewal",
        receivedAt: new Date().toISOString(),
        snippet: "Request for guidance on annual renewal process and required documents.",
        source: "sample",
        subject: "Renewal guidance request",
      },
    ],
  };
}

function readStore(): GmailStore {
  const file = gmailPath();
  if (!existsSync(file)) return seedStore();

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { mailRecords: Array.isArray(parsed.mailRecords) ? parsed.mailRecords : [] };
  } catch {
    return seedStore();
  }
}

function writeStore(store: GmailStore) {
  const file = gmailPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

export function categorizeMailText(text: string) {
  const value = text.toLowerCase();
  const match = MAIL_CATEGORY_RULES.find((rule) => rule.keywords.some((keyword) => value.includes(keyword)));
  return match?.category ?? "General Correspondence";
}

function rankedCounts(values: string[]) {
  const counts = values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));
}

function yearlyCounts(records: AgencyMailRecord[]) {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const date = new Date(record.receivedAt);
    const year = Number.isNaN(date.getTime()) ? "Unknown" : String(date.getFullYear());
    counts[year] = (counts[year] ?? 0) + 1;
  }
  return Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)).map(([year, count]) => ({ year, count }));
}

export function listAgencyMailRecords() {
  return readStore().mailRecords.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
}

export function saveAgencyMailRecord(record: Omit<AgencyMailRecord, "category" | "id" | "receivedAt" | "source"> & Partial<Pick<AgencyMailRecord, "category" | "receivedAt" | "source">>) {
  const store = readStore();
  const text = record.subject + " " + record.snippet;
  const mail: AgencyMailRecord = {
    category: record.category || categorizeMailText(text),
    from: record.from,
    id: "mail-" + Date.now().toString(36),
    receivedAt: record.receivedAt || new Date().toISOString(),
    snippet: record.snippet,
    source: record.source || "sample",
    subject: record.subject,
  };
  store.mailRecords.unshift(mail);
  writeStore(store);
  return mail;
}

export function getGmailConnectionStatus() {
  const configured = Boolean(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET && process.env.GMAIL_REFRESH_TOKEN);
  return {
    configured,
    mode: configured ? "gmail_api_ready" : "local_records_only",
    note: configured
      ? "Gmail credentials are present. Sync can be enabled to pull live agency mail into this intelligence view."
      : "Add GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN to enable Gmail tracking.",
  };
}

export function getGmailSummary() {
  const records = listAgencyMailRecords();
  const topCategory = rankedCounts(records.map((record) => record.category))[0] ?? null;

  return {
    categoryCounts: rankedCounts(records.map((record) => record.category)),
    configured: getGmailConnectionStatus().configured,
    latestMailAt: records[0]?.receivedAt ?? null,
    sourceCounts: rankedCounts(records.map((record) => record.source)),
    topCategory,
    totalMailRecords: records.length,
    yearlyCounts: yearlyCounts(records),
  };
}
