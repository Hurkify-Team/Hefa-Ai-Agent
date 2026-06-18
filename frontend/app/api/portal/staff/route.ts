import { fail, ok } from "@/lib/apiResponse";
import { buildStaffIndex, findStaffIntegrityIssues, searchStaffIntelligence } from "@/lib/staffIntelligence";

export const runtime = "nodejs";

function issueCounts(issues: ReturnType<typeof findStaffIntegrityIssues>) {
  return issues.reduce<Record<string, number>>((acc, issue) => {
    acc[issue.type] = (acc[issue.type] ?? 0) + 1;
    return acc;
  }, {});
}

function row(record: ReturnType<typeof buildStaffIndex>[number]) {
  return {
    staffName: record.staffName,
    profession: record.profession,
    registrationNumber: record.registrationNumber,
    facilityName: record.facilityName,
    category: record.category,
    hefamaaId: record.hefamaaId,
    renewalYear: record.renewalYear,
    registrationStatus: record.registrationStatus,
    capturedAt: record.capturedAt,
    sourceUrl: record.sourceUrl,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 50), 1), 250);
    const includeIssues = url.searchParams.get("issues") !== "false";

    const index = buildStaffIndex();
    const matches = query ? searchStaffIntelligence(query, index) : index;
    const issues = includeIssues ? findStaffIntegrityIssues(index) : [];

    return ok({
      totalStaffRecords: index.length,
      query: query || null,
      matchCount: matches.length,
      records: matches.slice(0, limit).map(row),
      issueCount: issues.length,
      issueCounts: issueCounts(issues),
      issues: issues.slice(0, 25).map((issue) => ({
        type: issue.type,
        key: issue.key,
        summary: issue.summary,
        records: issue.records.slice(0, 10).map(row),
      })),
    });
  } catch (error) {
    return fail(error, 500);
  }
}
