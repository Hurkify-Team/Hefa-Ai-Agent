import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";

  if (!key) {
    return NextResponse.json({ success: false, error: "Missing GEMINI_API_KEY" });
  }

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

  const data = await res.json();

  return NextResponse.json({
    model,
    status: res.status,
    success: res.ok,
    data,
  });
}
