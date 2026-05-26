import { ok, fail } from "@/lib/apiResponse";
import { mapPortalTextToSheetHeaders } from "@/lib/geminiMapper";
import { readExistingRecords, readSheetHeaders } from "@/lib/googleSheets";
import { aiMapFieldsSchema, extractedOutputSchema } from "@/lib/validators";

export const runtime = "nodejs";

type PartialMapFieldsBody = {
  category?: string;
  headers?: string[];
  sampleRows?: unknown[];
  portalText?: string;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PartialMapFieldsBody;
    const category = body.category;

    if (category && !body.headers) {
      body.headers = (await readSheetHeaders(category)).headers;
    }

    if (category && (!body.sampleRows || body.sampleRows.length === 0)) {
      body.sampleRows = (await readExistingRecords(category)).rows.slice(0, 10);
    }

    const payload = aiMapFieldsSchema.parse(body);
    const result = await mapPortalTextToSheetHeaders(payload);
    extractedOutputSchema.parse({ ...payload, ...result });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
