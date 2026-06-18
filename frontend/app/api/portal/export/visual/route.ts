import { filterPortalFacilityRecords } from "@/lib/portalIntelligence";
import { getPortalFacilitySummary } from "@/lib/playwrightPortal";
import { portalFiltersFromUrl } from "@/lib/portalFilterParams";

export const runtime = "nodejs";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function barRows(rows: Array<{ label: string; count: number }>, max = Math.max(1, ...rows.map((row) => row.count))) {
  return rows.map((row) => {
    const width = Math.max(3, Math.round((row.count / max) * 100));
    return `<div class="bar-row"><div class="bar-meta"><span>${escapeHtml(row.label)}</span><strong>${row.count.toLocaleString("en-NG")}</strong></div><div class="bar-track"><span style="width: ${width}%"></span></div></div>`;
  }).join("");
}

export async function GET(request: Request) {
  const filters = portalFiltersFromUrl(request);
  const result = filterPortalFacilityRecords(filters);
  const summary = getPortalFacilitySummary();
  const categoryRows = summary.categoryCounts.slice(0, 12).map((entry) => ({ label: entry.category, count: entry.count }));
  const statusRows = Object.entries(summary.statusCounts).map(([label, count]) => ({ label: label.replace(/_/g, " "), count }));
  const yearRows = summary.yearlyPortalRecordCounts.map((entry) => ({ label: String(entry.year), count: entry.count }));
  const generatedAt = new Date().toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short" });

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>HEFAMAA Portal Visual Report</title>
  <style>
    :root { --green: #047857; --green2: #10b981; --navy: #071923; --line: #d9e5df; --muted: #64748b; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #102018; background: #f3f7f5; }
    .hero { padding: 36px 42px; color: white; background: linear-gradient(135deg, var(--navy), #1e40af 70%, #1d4ed8); }
    .hero h1 { margin: 0; font-size: 30px; letter-spacing: -0.03em; }
    .hero p { margin: 8px 0 0; color: #d7f8e7; }
    .wrap { padding: 28px 42px 42px; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 18px; }
    .metric, .card { border: 1px solid var(--line); border-radius: 18px; background: white; box-shadow: 0 18px 48px rgba(15, 23, 42, 0.08); }
    .metric { padding: 18px; }
    .metric span { display: block; color: var(--muted); font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .12em; }
    .metric strong { display: block; margin-top: 8px; font-size: 28px; color: #061c18; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
    .card { padding: 20px; page-break-inside: avoid; }
    .card h2 { margin: 0 0 16px; font-size: 16px; color: #061c18; }
    .bar-row { margin: 0 0 13px; }
    .bar-meta { display: flex; justify-content: space-between; gap: 16px; font-size: 12px; font-weight: 750; color: #21352e; }
    .bar-meta span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar-track { height: 8px; margin-top: 7px; overflow: hidden; border-radius: 99px; background: #e8f3ee; }
    .bar-track span { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--green), var(--green2)); }
    .footer { margin-top: 22px; color: var(--muted); font-size: 12px; }
    @media print { body { background: white; } .metric, .card { box-shadow: none; } .wrap { padding: 22px; } }
  </style>
</head>
<body>
  <section class="hero">
    <h1>HEFAMAA Portal Visual Report</h1>
    <p>Generated ${escapeHtml(generatedAt)}. Filters: ${escapeHtml(JSON.stringify(filters))}. Matching export rows: ${result.totalMatches.toLocaleString("en-NG")}.</p>
  </section>
  <main class="wrap">
    <section class="metrics">
      <div class="metric"><span>Portal rows</span><strong>${summary.totalPortalRecords.toLocaleString("en-NG")}</strong></div>
      <div class="metric"><span>Distinct facilities</span><strong>${summary.totalFacilities.toLocaleString("en-NG")}</strong></div>
      <div class="metric"><span>New registrations</span><strong>${summary.facilityTypeCounts.new_registration.toLocaleString("en-NG")}</strong></div>
      <div class="metric"><span>Existing facilities</span><strong>${summary.facilityTypeCounts.existing_facility.toLocaleString("en-NG")}</strong></div>
    </section>
    <section class="grid">
      <div class="card"><h2>Top Facility Categories</h2>${barRows(categoryRows)}</div>
      <div class="card"><h2>Workflow Status Distribution</h2>${barRows(statusRows)}</div>
      <div class="card"><h2>Portal Records by Year</h2>${barRows(yearRows)}</div>
      <div class="card"><h2>Detail Capture Progress</h2>${barRows([{ label: "Captured details", count: summary.detailRecords }, { label: "Remaining indexed rows", count: Math.max(0, summary.totalPortalRecords - summary.detailRecords) }])}</div>
    </section>
    <p class="footer">Prepared by HEFAMAA Smart Registry Agent. Use browser Print to save this visual report as PDF for presentations.</p>
  </main>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": "inline; filename=hefamaa-portal-visual-report.html",
    },
  });
}
