import { NextResponse } from "next/server";

import { logMemory } from "@/lib/memory";
import { maxResults, searchFacilityIndex } from "@/lib/facilitySearchIndex";
import { safeRequestJson } from "@/lib/safeJson";

export const runtime = "nodejs";

function errorPayload(error: unknown) {
  const message = error instanceof Error ? error.message : "Facility search failed";
  return {
    success: false,
    ok: false,
    error: message,
    stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
  };
}

function limitValue(value: string | number | null | undefined) {
  const limit = Number(value ?? maxResults());
  return Math.max(1, Math.min(Number.isFinite(limit) ? limit : maxResults(), maxResults()));
}

async function runSearch(query: string, limit: number) {
  if (!query.trim()) return { intent: null, results: [], total: 0 };
  return searchFacilityIndex(query.trim(), limit);
}

export async function GET(request: Request) {
  console.log("[/api/facilities/search] started");

  try {
    logMemory("/api/facilities/search start");
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query") ?? "";
    const limit = limitValue(searchParams.get("limit"));
    const result = await runSearch(query, limit);
    logMemory("/api/facilities/search end");
    return NextResponse.json({
      success: true,
      ok: true,
      query,
      results: result.results,
      data: result.results,
      total: result.total,
      intent: result.intent,
    });
  } catch (error) {
    console.error("[/api/facilities/search] failed", error);
    return NextResponse.json(errorPayload(error), { status: 500 });
  }
}

export async function POST(request: Request) {
  console.log("[/api/facilities/search] started");

  try {
    logMemory("/api/facilities/search start");
    const body = await safeRequestJson<{ query?: string; limit?: number }>(request, "app/api/facilities/search/route.ts", {});
    const query = body.query ?? "";
    const limit = limitValue(body.limit);
    const result = await runSearch(query, limit);
    logMemory("/api/facilities/search end");
    return NextResponse.json({
      success: true,
      ok: true,
      query,
      results: result.results,
      data: result.results,
      total: result.total,
      intent: result.intent,
    });
  } catch (error) {
    console.error("[/api/facilities/search] failed", error);
    return NextResponse.json(errorPayload(error), { status: 500 });
  }
}
