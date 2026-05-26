import { ok, fail } from "@/lib/apiResponse";
import { captureCurrentPageText, getCurrentPortalUrl } from "@/lib/playwrightPortal";

export const runtime = "nodejs";

export async function POST() {
  try {
    const page = await captureCurrentPageText();
    const url = await getCurrentPortalUrl();

    return ok({
      url,
      text: page.text,
      bodyText: page.bodyText,
      formFields: page.formFields,
      tables: page.tables,
      currentRenewalYear: page.currentRenewalYear,
      latestAvailableRenewalYear: page.latestAvailableRenewalYear,
      renewalStatus: page.renewalStatus,
      selectedPortalRecord: page.selectedPortalRecord,
      selectedRenewalYear: page.selectedRenewalYear,
    });
  } catch (error) {
    return fail(error, 500);
  }
}
