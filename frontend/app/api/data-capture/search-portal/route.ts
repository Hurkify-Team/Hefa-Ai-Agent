import { z } from "zod";

import { fail, ok } from "@/lib/apiResponse";
import { safeRequestJson } from "@/lib/safeJson";
import { getPortalSessionManagerStatus, searchFacility } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

const schema = z.object({
  facilityName: z.string().trim().min(1, "Facility name is required"),
});

export async function POST(request: Request) {
  try {
    const payload = schema.parse(await safeRequestJson(request, "app/api/data-capture/search-portal/route.ts"));
    const status = await getPortalSessionManagerStatus();
    if (!status.browserOpen || !status.loggedIn) {
      throw new Error("Please open portal and login first.");
    }

    const result = await searchFacility({ facilityName: payload.facilityName, openSelectedRecord: false });
    return ok({
      success: true,
      facilityName: payload.facilityName,
      status: result.status,
      matches: result.matches ?? [],
      matchCount: result.matchCount ?? 0,
      selectedPortalRecord: result.selectedPortalRecord ?? null,
      note: result.note,
      url: result.url,
    });
  } catch (error) {
    return fail(error);
  }
}
