import { safeJsonResponse } from "@/lib/safeJson";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    return NextResponse.json({ success: false, error: "Missing GEMINI_API_KEY" });
  }

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": key,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Say HELLO" }] }],
        }),
      },
    );

    const data = await safeJsonResponse<Record<string, any>>(res, "app/api/test-gemini/route.ts");

    return NextResponse.json({
      model,
      status: res.status,
      success: res.ok,
      data,
    });
  } catch (error) {
    console.error("[/api/test-gemini] Gemini test failed", error);
    return NextResponse.json(
      {
        model,
        success: false,
        error: error instanceof Error ? error.message : "Gemini test failed",
      },
      { status: 502 },
    );
  }
}
