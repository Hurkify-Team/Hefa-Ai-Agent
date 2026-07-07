import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { saveCapturedDataToSheet } from "@/lib/dataCaptureWorkflow";
import { safeRequestJson } from "@/lib/safeJson";

export const runtime = "nodejs";

const schema = z.object({
  capturedData: z.record(z.string(), z.unknown()),
  targetSheet: z.string().trim().optional(),
  mode: z.literal("insert_or_update").default("insert_or_update"),
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await safeRequestJson(request, "app/api/data-capture/save-to-sheet/route.ts"));
    return ok(await saveCapturedDataToSheet(payload));
  } catch (error) {
    return fail(error);
  }
}
