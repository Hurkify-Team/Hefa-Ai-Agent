import { ok, fail } from "@/lib/apiResponse";
import { logAuditEntry } from "@/lib/auditLog";
import { answerDatabaseQuestion } from "@/lib/sheetAnalyzer";
import { askDatabaseSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = askDatabaseSchema.parse(await request.json());
    const result = await answerDatabaseQuestion(payload.question, payload.category);

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
