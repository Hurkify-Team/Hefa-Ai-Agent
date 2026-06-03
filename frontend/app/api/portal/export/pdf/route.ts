import { createPortalFacilitiesPdfExport } from "@/lib/portalExports";
import { portalFiltersFromUrl } from "@/lib/portalFilterParams";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const file = createPortalFacilitiesPdfExport(portalFiltersFromUrl(request));
  return new Response(file.body, {
    headers: {
      "Content-Disposition": "attachment; filename=\"" + file.filename + "\"",
      "Content-Type": file.contentType,
    },
  });
}
