import { ok, fail } from "@/lib/apiResponse";
import { readExistingRecords } from "@/lib/googleSheets";
import { categoryPayloadSchema } from "@/lib/validators";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const payload = categoryPayloadSchema.parse({ category: searchParams.get("category") });
    return ok(await readExistingRecords(payload.category));
  } catch (error) {
    return fail(error);
  }
}
