import { safeRequestJson } from "@/lib/safeJson";
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
    const body = (await safeRequestJson(request, "app/api/ai/map-fields/route.ts")) as PartialMapFieldsBody;
    const category = body.category;

    if (category && !body.headers) {
      body.headers = (await readSheetHeaders(category)).headers;
    }

    const fastMappingEnabled = !/^(0|false|no)$/i.test(process.env.DATA_CAPTURE_FAST_MAPPING?.trim() ?? "true");

    if (!fastMappingEnabled && category && (!body.sampleRows || body.sampleRows.length === 0)) {
      body.sampleRows = (await readExistingRecords(category)).rows.slice(0, 10);
    }

    if (fastMappingEnabled && !body.sampleRows) {
      body.sampleRows = [];
    }

    const payload = aiMapFieldsSchema.parse(body);
    const result = await mapPortalTextToSheetHeaders(payload);
    extractedOutputSchema.parse({ ...payload, ...result });

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
