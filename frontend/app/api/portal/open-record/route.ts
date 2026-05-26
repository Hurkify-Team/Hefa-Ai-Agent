import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { openSearchResultRecord } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

const openRecordSchema = z.object({
  rowIndex: z.number().int().min(0),
});

export async function POST(request: Request) {
  try {
    const payload = openRecordSchema.parse(await request.json());
    return ok(await openSearchResultRecord(payload));
  } catch (error) {
    return fail(error);
  }
}
