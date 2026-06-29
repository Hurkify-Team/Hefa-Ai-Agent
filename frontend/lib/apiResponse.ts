import { NextResponse } from "next/server";
import { ZodError } from "zod";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

function errorCode(error: unknown) {
  const message = errorMessage(error).toLowerCase();

  if (message.includes("google sheets") || message.includes("google_sheet") || message.includes("google_sheet_id")) {
    return "GOOGLE_SHEETS_NOT_CONFIGURED";
  }
  if (message.includes("gemini")) return "GEMINI_UNAVAILABLE";
  if (message.includes("sqlite") || message.includes("audit") || message.includes("database")) return "DATABASE_UNAVAILABLE";
  if (message.includes("playwright") || message.includes("portal") || message.includes("browser")) return "PORTAL_UNAVAILABLE";
  if (message.includes("notification") || message.includes("email") || message.includes("sms")) return "NOTIFICATIONS_UNAVAILABLE";
  if (message.includes("auth") || message.includes("session") || message.includes("password")) return "AUTH_UNAVAILABLE";
  if (message.includes("enoent") || message.includes("eacces") || message.includes("storage") || message.includes("file")) return "STORAGE_UNAVAILABLE";

  return "API_ERROR";
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, success: true, data }, { status });
}

export function fail(error: unknown, status = 400) {
  if (error instanceof ZodError) {
    const readableIssues = error.issues.map((issue) => {
      const field = issue.path.join(".") || "Input";
      return field + ": " + issue.message;
    });
    const message = readableIssues[0] ?? "Validation failed";

    return NextResponse.json(
      {
        ok: false,
        success: false,
        error: message,
        details: message,
        code: "VALIDATION_ERROR",
        issues: error.issues,
      },
      { status },
    );
  }

  const message = errorMessage(error);
  return NextResponse.json(
    {
      ok: false,
      success: false,
      error: message,
      details: message,
      code: errorCode(error),
    },
    { status },
  );
}

export async function safeApi<T>(route: string, handler: () => Promise<Response | T> | Response | T, status = 500) {
  console.info("START:", route);

  try {
    const result = await handler();
    console.info("SUCCESS:", route + " completed");
    return result instanceof Response ? result : ok(result);
  } catch (error) {
    console.error("ERROR:", route + " failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
    return fail(error, status);
  }
}
