import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { logMemory } from "@/lib/memory";
import { filterPortalFacilityRecords } from "@/lib/portalIntelligence";

export const runtime = "nodejs";

const searchSchema = z.object({
  applicationType: z.string().trim().optional(),
  category: z.string().trim().optional(),
  facilityType: z.string().trim().optional(),
  lga: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  query: z.string().trim().optional(),
  status: z.string().trim().optional(),
  year: z.coerce.number().int().min(2000).max(2200).optional(),
});

export async function GET(request: Request) {
  try {
    logMemory("/api/portal/records start");
    const url = new URL(request.url);
    const params = searchSchema.parse({
      applicationType: url.searchParams.get("applicationType") || undefined,
      category: url.searchParams.get("category") || undefined,
      facilityType: url.searchParams.get("facilityType") || undefined,
      lga: url.searchParams.get("lga") || undefined,
      limit: url.searchParams.get("limit") || undefined,
      query: url.searchParams.get("query") || undefined,
      status: url.searchParams.get("status") || undefined,
      year: url.searchParams.get("year") || undefined,
    });
    const result = filterPortalFacilityRecords(params);

    logMemory("/api/portal/records end");
    return ok({
      cachedFacilities: result.allRecords.length,
      matchCount: result.totalMatches,
      records: result.records,
    });
  } catch (error) {
    return fail(error);
  }
}
