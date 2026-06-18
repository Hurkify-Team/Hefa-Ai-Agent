import { z } from "zod";

import { ok, fail } from "@/lib/apiResponse";
import { startPortalFacilityScan } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

const scanSchema = z.object({
  mode: z.enum(["quick", "full"]).default("quick"),
});

async function readPayload(request: Request) {
  const raw = await request.text();
  if (!raw.trim()) return { mode: "quick" as const };
  return scanSchema.parse(JSON.parse(raw));
}

export async function POST(request: Request) {
  try {
    const payload = await readPayload(request);
    return ok(startPortalFacilityScan({ mode: payload.mode }));
  } catch (error) {
    return fail(error, 500);
  }
}
