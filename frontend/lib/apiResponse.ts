import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function ok<T>(data: T, status = 200) {
  return NextResponse.json({ ok: true, data }, { status });
}

export function fail(error: unknown, status = 400) {
  if (error instanceof ZodError) {
    const readableIssues = error.issues.map((issue) => {
      const field = issue.path.join(".") || "Input";
      return field + ": " + issue.message;
    });

    return NextResponse.json(
      {
        ok: false,
        error: readableIssues[0] ?? "Validation failed",
        issues: error.issues,
      },
      { status },
    );
  }

  return NextResponse.json(
    {
      ok: false,
      error: error instanceof Error ? error.message : "Unexpected error",
    },
    { status },
  );
}
