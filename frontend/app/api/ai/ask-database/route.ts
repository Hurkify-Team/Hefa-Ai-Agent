import { safeRequestJson } from "@/lib/safeJson";
import { ok, fail } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { answerGlobalFacilityTotalQuestion, isGlobalFacilityTotalQuestion } from "@/lib/fastFacilitySummary";
import type { SheetRow } from "@/types/sheet";
import { askDatabaseSchema } from "@/lib/validators";

export const runtime = "nodejs";

function isNotificationIntelligenceQuestion(question: string) {
  return /document(s)? queried|reminder queue|requires reminders|require reminders|need reminders|hefamaa action|staff action|internal attention|final approval pending|awaiting final approval|overdue renewal|renewal overdue|stale cache|changed status|status changed|notification/i.test(question.toLowerCase());
}

function toSheetRows(rows: Array<Record<string, unknown>> | undefined): SheetRow[] | undefined {
  return rows?.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
    if (typeof value === "number" || value === null) return [key, value];
    return [key, value === undefined ? null : String(value)];
  })) as SheetRow);
}

export async function POST(request: Request) {
  try {
    const payload = askDatabaseSchema.parse(await safeRequestJson(request, "app/api/ai/ask-database/route.ts"));
    const result = isGlobalFacilityTotalQuestion(payload.question)
      ? (() => {
        const fast = answerGlobalFacilityTotalQuestion(payload.question);
        return { question: payload.question, answer: fast.answer, rows: toSheetRows(fast.rows) };
      })()
      : isNotificationIntelligenceQuestion(payload.question)
      ? await import("@/lib/knowledgeEngine").then(async ({ answerQuestion }) => {
        const knowledge = await answerQuestion({ category: payload.category, question: payload.question });
        return { question: payload.question, answer: knowledge.answer, rows: toSheetRows(knowledge.rows) };
      })
      : await import("@/lib/sheetAnalyzer").then(({ answerDatabaseQuestion }) => answerDatabaseQuestion(payload.question, payload.category));

    await logAuditEntry({
      user: "Admin User",
      actionType: "analysis",
      category: payload.category,
      status: "success",
      details: payload.question,
    });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
