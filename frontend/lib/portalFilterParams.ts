import type { PortalRecordFilters } from "@/lib/portalIntelligence";

export function portalFiltersFromUrl(request: Request): PortalRecordFilters {
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year"));
  const limit = Number(url.searchParams.get("limit"));

  return {
    applicationType: url.searchParams.get("applicationType") || undefined,
    category: url.searchParams.get("category") || undefined,
    facilityType: url.searchParams.get("facilityType") || undefined,
    lga: url.searchParams.get("lga") || undefined,
    limit: Number.isInteger(limit) && limit > 0 ? limit : undefined,
    query: url.searchParams.get("query") || undefined,
    status: url.searchParams.get("status") || undefined,
    year: Number.isInteger(year) && year >= 2000 ? year : undefined,
  };
}
