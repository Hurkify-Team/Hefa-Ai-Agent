import { z } from "zod";

import { ok, fail } from "@/lib/apiResponse";
import { startPortalFacilityScan } from "@/lib/playwrightPortal";
import { safeRequestJson } from "@/lib/safeJson";

export const runtime = "nodejs";

const scanSchema = z.object({
  mode: z.enum(["quick", "full"]).default("quick"),
});

async function readPayload(request: Request) {
  const body = await safeRequestJson(request, "app/api/portal/scan/route.ts", {});
  return scanSchema.parse(body);
}

export async function POST(request: Request) {
  try {
    const payload = await readPayload(request);
    return ok(startPortalFacilityScan({ mode: payload.mode }));
  } catch (error) {
    return fail(error, 500);
  }
}
