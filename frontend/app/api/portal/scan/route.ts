import { z } from "zod";

import { ok, fail } from "@/lib/apiResponse";
import { logMemory } from "@/lib/memory";
import { startPortalFacilityScan } from "@/lib/playwrightPortal";
import { safeRequestJson } from "@/lib/safeJson";

export const runtime = "nodejs";

const scanSchema = z.object({
  mode: z.enum(["quick", "full", "fresh_full_scan"]).default("quick"),
  onlyMissingBeds: z.boolean().optional(),
});

async function readPayload(request: Request) {
  const body = await safeRequestJson(request, "app/api/portal/scan/route.ts", {});
  return scanSchema.parse(body);
}

export async function POST(request: Request) {
  try {
    logMemory("/api/portal/scan start");
    const payload = await readPayload(request);
    const result = await startPortalFacilityScan({ mode: payload.mode, onlyMissingBeds: payload.onlyMissingBeds });
    logMemory("/api/portal/scan end");
    return ok(result);
  } catch (error) {
    return fail(error, 500);
  }
}
