import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { buildPortalAutofill } from "@/lib/portalAutofill";

export const runtime = "nodejs";

const portalAutofillSchema = z.object({
  category: z.string().trim().optional(),
  query: z.string().trim().min(1, "Facility search query is required"),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const payload = portalAutofillSchema.parse({
      category: url.searchParams.get("category") || undefined,
      query: url.searchParams.get("query") || "",
    });

    return ok(await buildPortalAutofill(payload));
  } catch (error) {
    return fail(error);
  }
}
