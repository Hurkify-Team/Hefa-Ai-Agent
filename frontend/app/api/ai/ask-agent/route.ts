import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { answerGlobalFacilityTotalQuestion, isGlobalFacilityTotalQuestion } from "@/lib/fastFacilitySummary";
import { readPortalListCacheLightweight } from "@/lib/portalCacheStore";

export const runtime = "nodejs";

const askAgentSchema = z.object({
  question: z.string().trim().min(1, "Question is required"),
  category: z.string().trim().min(1).optional(),
  sources: z.array(z.enum(["portal", "sheets"])).optional(),
  sessionId: z.string().trim().optional(),
});

type AgentSource = "portal" | "sheets";

type AgentSourceResult = {
  source: AgentSource;
  label: string;
  status: "ok" | "error";
  answer?: string;
  error?: string;
  rows?: Array<Record<string, unknown>>;
  record?: Record<string, unknown>;
  summary?: unknown;
};

type AgentAction = {
  description: string;
  href: string;
  label: string;
  source: AgentSource;
};

const SOURCE_LABELS: Record<AgentSource, string> = {
  portal: "HEFAMAA Portal Scan",
  sheets: "HEFAMAA Active + Old Databases",
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compactValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed.length > 240 ? trimmed.slice(0, 237) + "..." : trimmed;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function compactRecord(record: Record<string, unknown> | undefined) {
  if (!record) return undefined;
  const visibleFields = record.visibleFields && typeof record.visibleFields === "object"
    ? Object.fromEntries(Object.entries(record.visibleFields as Record<string, unknown>).slice(0, 12).map(([key, value]) => [key, compactValue(value)]))
    : undefined;

  return {
    facilityName: compactValue(record.facilityName),
    hefamaaId: compactValue(record.hefamaaId),
    category: compactValue(record.category),
    registrationStatus: compactValue(record.registrationStatus),
    applicationType: compactValue(record.applicationType),
    normalizedStatus: compactValue(record.normalizedStatus),
    renewalYear: compactValue(record.renewalYear),
    recordDate: compactValue(record.recordDate),
    visibleFields,
  };
}

function compactRows(rows: unknown, limit = 8) {
  if (!Array.isArray(rows)) return undefined;
  return rows.slice(0, limit).map((row) => {
    if (!row || typeof row !== "object") return { Value: compactValue(row) };
    return Object.fromEntries(Object.entries(row as Record<string, unknown>).slice(0, 18).map(([key, value]) => [key, compactValue(value)]));
  });
}

function isStaffQuestion(question: string) {
  return /staff\s+name|professional\s+staff|medical\s+professional\s+data|where\s+is\s+.+\s+(?:working|work|presently|currently)|where\s+does\s+.+\s+work|working\s+presently|how\s+many\s+facilit(?:y|ies).*?(?:appear|appearing|working|work|listed)|facilit(?:y|ies).*?(?:staff|name|professional).*?(?:appear|appearing|working|work)|mdcn|mlscn|nmcn|pcn|manipulat|same\s+registration/i.test(question);
}

function isHefNoQuestion(question: string) {
  const staffRegistryIntent = isStaffQuestion(question);
  const asksForOfficialRegistryNumber = /\b(?:hefamaa|hef\/?no|hef\s*no|facility\s*code|facility\s*number)\b/i.test(question);
  const asksForFacilityRegistrationNumber = !staffRegistryIntent && /\bfacility\s+registration\s*(?:number|no)\b/i.test(question);
  const lookupIntent = /\b(?:number|no|code|provide|give|show|find|what|lookup|look\s+up|tell)\b/i.test(question);
  return (asksForOfficialRegistryNumber || asksForFacilityRegistrationNumber) && lookupIntent;
}

function sheetRequiredQuestion(question: string) {
  return isHefNoQuestion(question) || /\b(?:spreadsheet|google\s*sheet|sheet|workbook|active\s+database|old\s+database|facility\s+code|serial|s\/n|row|missing|incomplete|duplicate|data\s+cleaning|cleaning)\b/i.test(question);
}

function bothSourcesQuestion(question: string) {
  return /\b(?:both\s+sources|cross\s*check|cross-check|compare|reconcile|portal\s+and\s+(?:sheet|spreadsheet|database)|(?:sheet|spreadsheet|database)\s+and\s+portal|active\s+and\s+old)\b/i.test(question);
}

function selectSourcesForQuestion(question: string, requestedSources: AgentSource[]) {
  const unique = Array.from(new Set(requestedSources)) as AgentSource[];
  if (isHefNoQuestion(question)) return ["sheets"] as AgentSource[];
  if (unique.length <= 1) return unique;
  if (bothSourcesQuestion(question)) return unique;
  if (sheetRequiredQuestion(question)) return unique.includes("sheets") ? ["sheets"] as AgentSource[] : unique;
  return unique.includes("portal") ? ["portal"] as AgentSource[] : unique;
}

function sourceTimeoutMs(source: AgentSource, question: string) {
  if (source === "portal") return 2_500;
  if (isHefNoQuestion(question)) return 12_000;
  if (bothSourcesQuestion(question)) return 6_500;
  return 5_000;
}

function withSourceTimeout<T>(promise: Promise<T>, timeoutMs: number, source: AgentSource) {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(SOURCE_LABELS[source] + " lookup timed out after " + Math.round(timeoutMs / 1000) + " seconds.")), timeoutMs);
    }),
  ]);
}

function sourceError(source: AgentSource, error: unknown): AgentSourceResult {
  return {
    source,
    label: SOURCE_LABELS[source],
    status: "error",
    error: error instanceof Error ? error.message : "Unable to read this source.",
  };
}

function portalSummary() {
  const records = readPortalListCacheLightweight();
  const categories = new Map<string, number>();
  const statuses: Record<string, number> = {};
  const names = new Set<string>();
  for (const record of records) {
    const category = clean(record.category) || "Unknown Category";
    const status = clean(record.normalizedStatus || record.registrationStatus) || "unknown_status";
    const facilityKey = normalize(record.facilityName || record.hefamaaId);
    if (facilityKey) names.add(facilityKey);
    categories.set(category, (categories.get(category) ?? 0) + 1);
    statuses[status] = (statuses[status] ?? 0) + 1;
  }
  return {
    categoryCounts: Array.from(categories.entries()).map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
    statusCounts: statuses,
    totalFacilities: names.size,
    totalPortalRecords: records.length,
  };
}

function answerPortalSummaryQuestion(question: string) {
  const summary = portalSummary();
  const lower = question.toLowerCase();
  if (/categor/i.test(question) && /how many|count|total/i.test(question)) {
    return { answer: "Portal cache currently has " + summary.categoryCounts.length + " categories.", rows: summary.categoryCounts };
  }
  const category = summary.categoryCounts.find((entry) => lower.includes(entry.category.toLowerCase()));
  if (category && /how many|count|total/i.test(question)) {
    return { answer: category.count + " portal rows are currently listed under " + category.category + ".", rows: [category] };
  }
  if (/status|workflow/i.test(question) && /how many|count|total|summary/i.test(question)) {
    return { answer: "I grouped the portal cache by workflow status.", rows: Object.entries(summary.statusCounts).map(([Status, Count]) => ({ Status, Count })) };
  }
  if (/total|how many|count/i.test(question)) {
    return { answer: "The latest portal cache has " + summary.totalPortalRecords + " indexed rows and " + summary.totalFacilities + " distinct facility names." };
  }
  return { answer: "The latest portal cache is available offline: " + summary.totalPortalRecords + " indexed rows and " + summary.totalFacilities + " distinct facility names." };
}

function extractHefNoQuery(question: string) {
  const patterns = [
    /(?:hefamaa|hef\/?no|hef\s*no|facility\s*code|facility\s*number)\s+(?:for|of)\s+(.+)$/i,
    /(?:for|of)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1]) return clean(match[1].replace(/[?.!]+$/g, ""));
  }
  return clean(question.replace(/(?:what|is|the|hefamaa|hef\/?no|hef\s*no|number|code|facility|provide|give|show|find|for|of)/gi, " "));
}

async function callInternalApi<T>(requestUrl: string, path: string, init?: RequestInit): Promise<T> {
  const url = new URL(path, requestUrl);
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = await response.json() as { ok: boolean; data?: T; error?: string };
  if (!payload.ok) throw new Error(payload.error || "Internal source returned an error.");
  return payload.data as T;
}

async function answerHefNoViaSearch(question: string, category: string | undefined, _requestUrl: string) {
  const sheetAnalyzer = await import("@/lib/sheetAnalyzer");
  const query = sheetAnalyzer.extractHefamaaNumberLookupQuery(question) || extractHefNoQuery(question);

  if (!query) {
    return {
      answer: "Tell me the facility name so I can look up the official HEFAMAA number from the Google Sheet HEF/NO column, with Old Database Facility Code as fallback.",
      rows: undefined,
    };
  }

  const lookup = await sheetAnalyzer.lookupHefamaaNumberAcrossSources({ query, category, limit: 10 });
  const best = lookup.bestMatch;

  if (!best) {
    return {
      answer: "I could not find a facility matching \"" + query + "\" in the HEFAMAA Active Database or Old Hefamaa Database fallback. Please confirm the facility spelling or provide another identifier such as address, LGA, phone, or email.",
      rows: [],
      summary: { query, searchedSources: lookup.searchedSources, matchCount: 0 },
    };
  }

  const numberLabel = best.source === "old" ? "Facility Code" : "HEF/NO";
  const facilityName = clean(best.facilityName || query);
  const hefNo = clean(best.hefNo);
  const sourceNote = best.source === "old"
    ? "I used Old Hefamaa Database fallback because the active database did not provide a usable HEF/NO match."
    : "I used the HEFAMAA Active Database HEF/NO column on the same row as the facility name.";

  return {
    answer: [
      "The official HEFAMAA number for " + facilityName + " is " + (hefNo || "not recorded") + ".",
      "Source: " + best.sourceLabel + ", category " + best.category + ", row " + (best.rowIndex + 2) + ", column " + numberLabel + ".",
      sourceNote,
      best.address ? "Address: " + best.address + "." : "",
      best.lga ? "LGA: " + best.lga + "." : "",
    ].filter(Boolean).join(" "),
    rows: lookup.matches.map((match) => ({
      Source: match.sourceLabel,
      Category: match.category,
      "Workbook Row": match.rowIndex + 2,
      "HEF/NO / Facility Code": match.hefNo || null,
      "Facility Name": match.facilityName || null,
      Address: match.address || null,
      LGA: match.lga || null,
      Contact: match.contact || null,
      Email: match.email || null,
      source: match.source,
      sourceLabel: match.sourceLabel,
      category: match.category,
      rowIndex: match.rowIndex,
      hefNo: match.hefNo,
      facilityName: match.facilityName,
      address: match.address,
      lga: match.lga,
      contact: match.contact,
      email: match.email,
    })),
    summary: { query, searchedSources: lookup.searchedSources, matchCount: lookup.matches.length, bestSource: best.source },
  };
}

async function runSource(source: AgentSource, question: string, category: string | undefined, requestUrl: string): Promise<AgentSourceResult> {
  if (source === "portal") {
    const { answerPortalCacheQuestion } = await import("@/lib/portalCacheQa");
    const cacheAnswer = answerPortalCacheQuestion(question);
    const result = (cacheAnswer ?? answerPortalSummaryQuestion(question)) as { answer: string; record?: Record<string, unknown>; rows?: unknown; summary?: unknown };
    return {
      source,
      label: SOURCE_LABELS[source],
      status: "ok",
      answer: result.answer,
      rows: compactRows(result.rows, 12),
      record: compactRecord(result.record),
      summary: result.summary,
    };
  }

  if (isHefNoQuestion(question)) {
    const result = await answerHefNoViaSearch(question, category, requestUrl);
    return { source, label: SOURCE_LABELS[source], status: "ok", answer: result.answer, rows: compactRows(result.rows, 8) };
  }

  const data = await callInternalApi<{ answer: string; rows?: Array<Record<string, unknown>> }>(requestUrl, "/api/ai/ask-database", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, category }),
  });
  return { source, label: SOURCE_LABELS[source], status: "ok", answer: data.answer, rows: compactRows(data.rows, 8) };
}

function extractLgaFilter(question: string) {
  const match = question.match(/\bin\s+([a-z\s-]+?)\s+(?:local government|lga)\b/i) ?? question.match(/\b([a-z\s-]+?)\s+local government\b/i);
  return match?.[1]?.replace(/[?.!]+$/g, "").trim();
}

function shouldOfferExportActions(question: string) {
  if (isHefNoQuestion(question)) return false;
  return /\b(export|download|excel|pdf|visual|chart|graph|report)\b/i.test(question) || /\b(category|categories|lga|local government|total|how many|count|summary|list|facilities by|status|workflow|monthly|yearly|daily|weekly|analytics|analysis)\b/i.test(question);
}

function exportActionsForQuestion(question: string): AgentAction[] {
  if (!shouldOfferExportActions(question)) return [];
  const summary = portalSummary();
  const params = new URLSearchParams();
  const lowerQuestion = question.toLowerCase();
  const yearMatch = question.match(/\b(20\d{2})\b/);
  const categoryMatch = summary.categoryCounts.find((entry) => lowerQuestion.includes(entry.category.toLowerCase()));
  const statusMatch = Object.keys(summary.statusCounts).find((status) => lowerQuestion.includes(status.replace(/_/g, " ")));
  const lga = extractLgaFilter(question);
  if (categoryMatch) params.set("category", categoryMatch.category);
  if (yearMatch?.[1]) params.set("year", yearMatch[1]);
  if (statusMatch) params.set("status", statusMatch);
  if (lga) params.set("lga", lga);
  const suffix = params.toString() ? "?" + params.toString() : "";
  return [
    { source: "portal", label: "Download Excel Data", href: "/api/portal/export/excel" + suffix, description: params.toString() ? "Filtered portal workbook export" : "Full portal workbook export" },
    { source: "portal", label: "Download PDF Report", href: "/api/portal/export/pdf" + suffix, description: params.toString() ? "Filtered portal report" : "Full portal report" },
    { source: "portal", label: "Open Visual Charts", href: "/api/portal/export/visual" + suffix, description: params.toString() ? "Filtered visual charts" : "Full visual charts" },
  ];
}

function combineAnswers(sources: AgentSourceResult[], question: string) {
  const hefNoQuestion = isHefNoQuestion(question);
  const orderedSources = hefNoQuestion ? [...sources].sort((a, b) => (a.source === "sheets" ? -1 : 0) - (b.source === "sheets" ? -1 : 0)) : sources;
  const okSources = orderedSources.filter((source) => source.status === "ok");
  const errors = orderedSources.filter((source) => source.status === "error");
  if (!okSources.length) return "I could not answer from the available data sources. " + errors.map((source) => source.label + ": " + source.error).join(" ");

  const intro = hefNoQuestion
    ? "For HEFAMAA number questions, I used the HEFAMAA Active Database HEF/NO column, with Old Hefamaa Database as fallback. Portal E-HEFAMAA ID is a separate portal identifier."
    : okSources.length > 1
      ? "I checked the portal scan cache and workbook databases."
      : "I checked " + okSources[0].label + ".";
  const exportNote = !hefNoQuestion && shouldOfferExportActions(question) ? "Export actions are available for this answer: Excel data, PDF report, and visual charts can be generated from portal cache filters." : "";

  return [
    intro,
    ...orderedSources.map((source) => source.status === "ok" ? source.label + ": " + source.answer : source.label + ": unavailable for this question. " + source.error),
    exportNote,
  ].filter(Boolean).join("\n\n");
}

function isDirectPortalFieldQuestion(question: string) {
  return !/\b(how many|count|total|list|show all|breakdown|summary|report|export|download|notify|remind|email|sms|pending requirements|duplicate|missing fields?)\b/i.test(question);
}

function sourceFromKnowledge(source: "google_sheet" | "portal_cache"): AgentSource {
  return source === "google_sheet" ? "sheets" : "portal";
}

export async function POST(request: Request) {
  try {
    const payload = askAgentSchema.parse(await request.json());
    const requestedSources = payload.sources?.length ? payload.sources : ["portal", "sheets"] as AgentSource[];

    if (isHefNoQuestion(payload.question)) {
      const result = await answerHefNoViaSearch(payload.question, payload.category, request.url);
      return ok({
        question: payload.question,
        answer: "For HEFAMAA number questions, I used the Google Sheet database first. Portal E-HEFAMAA ID is a separate portal identifier.\n\n" + result.answer,
        sources: [{
          source: "sheets",
          label: SOURCE_LABELS.sheets,
          status: "ok",
          answer: result.answer,
          rows: compactRows(result.rows, 10),
          summary: result.summary,
        }],
        rows: compactRows(result.rows, 10),
        summary: result.summary,
        actions: [],
      });
    }

    if (requestedSources.includes("portal") && isStaffQuestion(payload.question)) {
      const staff = await import("@/lib/staffIntelligence");
      if (staff.isStaffQuestion(payload.question)) {
        const result = staff.answerStaffQuestion(payload.question);
        return ok({
          question: payload.question,
          answer: "I checked HEFAMAA Portal Professional Staff Index.\n\n" + result.answer,
          sources: [{
            source: "portal",
            label: "HEFAMAA Portal Professional Staff Index",
            status: "ok",
            answer: result.answer,
            rows: compactRows(result.rows, 25),
            summary: result.summary,
          }],
          rows: compactRows(result.rows, 25),
          summary: result.summary,
          actions: [],
        });
      }
    }

    if (requestedSources.includes("portal") && isGlobalFacilityTotalQuestion(payload.question)) {
      const result = answerGlobalFacilityTotalQuestion(payload.question);
      return ok({
        question: payload.question,
        answer: result.answer,
        sources: [{
          source: "portal",
          label: SOURCE_LABELS.portal,
          status: "ok",
          answer: result.answer,
          rows: compactRows(result.rows, 12),
          summary: result.summary,
        }],
        actions: exportActionsForQuestion(payload.question),
      });
    }

    const directPortalAnswer = requestedSources.includes("portal") && isDirectPortalFieldQuestion(payload.question)
      ? await import("@/lib/portalCacheQa").then(({ answerPortalCacheQuestion }) => answerPortalCacheQuestion(payload.question))
      : null;

    if (directPortalAnswer && !isHefNoQuestion(payload.question)) {
      return ok({
        question: payload.question,
        answer: "I checked HEFAMAA Portal Scan.\n\nHEFAMAA Portal Scan: " + directPortalAnswer.answer,
        sources: [{
          source: "portal",
          label: SOURCE_LABELS.portal,
          status: "ok",
          answer: directPortalAnswer.answer,
          rows: compactRows(directPortalAnswer.rows, 12),
          record: compactRecord(directPortalAnswer.record),
          summary: directPortalAnswer.summary,
        }],
        actions: [],
      });
    }

    const { answerQuestion } = await import("@/lib/knowledgeEngine");
    const knowledge = await answerQuestion({
      category: payload.category,
      question: payload.question,
      requestedSources,
      sessionId: payload.sessionId,
    });

    if (knowledge.intent.intent !== "unknown" || knowledge.rows?.length) {
      return ok({
        question: payload.question,
        answer: knowledge.answer,
        intent: knowledge.intent,
        sources: knowledge.sources.map((source) => ({
          source: sourceFromKnowledge(source.source),
          label: source.label,
          status: source.status,
          summary: source.summary,
        })),
        rows: knowledge.rows,
        summary: knowledge.summary,
        actions: knowledge.actions ?? [],
      });
    }

    const uniqueSources = selectSourcesForQuestion(payload.question, requestedSources as AgentSource[]);
    const settled = await Promise.allSettled(uniqueSources.map((source) => withSourceTimeout(runSource(source, payload.question, payload.category, request.url), sourceTimeoutMs(source, payload.question), source)));
    const sources = settled.map((result, index) => result.status === "fulfilled" ? result.value : sourceError(uniqueSources[index], result.reason));
    const responseSources = isHefNoQuestion(payload.question) ? [...sources].sort((a, b) => (a.source === "sheets" ? -1 : 0) - (b.source === "sheets" ? -1 : 0)) : sources;

    return ok({
      question: payload.question,
      answer: combineAnswers(responseSources, payload.question),
      sources: responseSources,
      actions: exportActionsForQuestion(payload.question),
    });
  } catch (error) {
    return fail(error);
  }
}
