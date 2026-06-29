import { safeApi } from "@/lib/apiResponse";
import { createPortalFacilitiesExcelExport } from "@/lib/portalExports";
import { portalFiltersFromUrl } from "@/lib/portalFilterParams";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return safeApi("/api/portal/export/excel", async () => {
    const file = await createPortalFacilitiesExcelExport(portalFiltersFromUrl(request));
    return new Response(file.body, {
      headers: {
        "Content-Disposition": "attachment; filename=\"" + file.filename + "\"",
        "Content-Type": file.contentType,
      },
    });
  });
}
