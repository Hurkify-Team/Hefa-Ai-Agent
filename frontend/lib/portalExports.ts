import ExcelJS from "exceljs";

import { getPortalFacilitySummary, type PortalFacilityRecord } from "@/lib/playwrightPortal";
import { filterPortalFacilityRecords, type PortalRecordFilters } from "@/lib/portalIntelligence";

const EXCEL_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function visibleHeaders(records: PortalFacilityRecord[]) {
  const headers = new Set<string>();
  for (const record of records) {
    for (const header of Object.keys(record.visibleFields ?? {})) headers.add(header);
  }
  return Array.from(headers);
}

function summaryRows(summary: ReturnType<typeof getPortalFacilitySummary>): Array<[string, string | number]> {
  return [
    ["Portal-reported rows", summary.portalReportedRecords ?? summary.totalPortalRecords],
    ["Indexed portal rows", summary.totalPortalRecords],
    ["Distinct facilities", summary.totalFacilities],
    ["New registrations", summary.facilityTypeCounts.new_registration],
    ["Existing facilities", summary.facilityTypeCounts.existing_facility],
    ["Unclassified facilities", summary.facilityTypeCounts.unknown],
    ["Last scanned", summary.lastScanned ?? "Never"],
  ];
}

export async function createPortalFacilitiesExcelExport(filters: PortalRecordFilters = {}) {
  const result = filterPortalFacilityRecords(filters);
  const records = result.records;
  const summary = getPortalFacilitySummary();
  const dynamicHeaders = visibleHeaders(records);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "HEFAMAA Smart Registry Agent";
  workbook.created = new Date();

  const overview = workbook.addWorksheet("Overview");
  overview.addRow(["HEFAMAA Portal Facility Index"]);
  overview.addRow(["Metric", "Value"]);
  for (const row of summaryRows(summary)) overview.addRow(row);
  overview.addRow(["Exported matching rows", result.totalMatches]);
  overview.addRow(["Export filters", JSON.stringify(filters)]);
  overview.addRow([]);
  overview.addRow(["Category", "Distinct Facilities"]);
  for (const category of summary.categoryCounts) overview.addRow([category.category, category.count]);
  overview.getColumn(1).width = 42;
  overview.getColumn(2).width = 22;
  overview.getRow(1).font = { bold: true, size: 14 };
  overview.getRow(2).font = { bold: true };

  const sheet = workbook.addWorksheet("Portal Records", { views: [{ state: "frozen", ySplit: 1 }] });
  const fixedHeaders = ["Facility Name", "E-HEFAMAA ID", "Category", "Registration Status", "Workflow Status", "Record Type", "Renewal Year", "Record Date", "Last Seen"];
  sheet.addRow([...fixedHeaders, ...dynamicHeaders]);
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF047857" } };
  for (const record of records) {
    sheet.addRow([
      record.facilityName,
      record.hefamaaId,
      record.category,
      record.registrationStatus,
      record.normalizedStatus,
      record.applicationType,
      record.renewalYear ?? "",
      record.recordDate ?? "",
      record.lastSeen,
      ...dynamicHeaders.map((header) => record.visibleFields?.[header] ?? ""),
    ]);
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: fixedHeaders.length + dynamicHeaders.length } };
  sheet.columns.forEach((column, index) => { column.width = index === 0 ? 36 : index === 3 ? 34 : 22; });

  return {
    body: new Uint8Array(await workbook.xlsx.writeBuffer()),
    contentType: EXCEL_MIME_TYPE,
    filename: "hefamaa-portal-facilities-" + exportTimestamp() + ".xlsx",
  };
}

function escapePdfText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

function wrapLine(value: string, width = 112) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if ((line + " " + word).length <= width) line += " " + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function recordPdfLines(record: PortalFacilityRecord, index: number) {
  const primary = (index + 1) + ". " + (record.facilityName || "Unnamed facility") + " | " + (record.hefamaaId || "No HEF number") + " | " + (record.category || "Uncategorised");
  const secondary = "Status: " + (record.registrationStatus || "Not visible") + " | Workflow: " + record.normalizedStatus + " | Type: " + record.applicationType + " | Year: " + (record.renewalYear ?? "-");
  return [...wrapLine(primary), ...wrapLine(secondary)];
}

function createSimplePdf(lines: string[]) {
  const pageLineLimit = 52;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageLineLimit) pages.push(lines.slice(index, index + pageLineLimit));
  if (!pages.length) pages.push(["No cached portal records found."]);
  const objects: string[] = [];
  const pageObjectIds = pages.map((_, index) => 4 + index * 2);
  const fontObjectId = 3;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [" + pageObjectIds.map((id) => id + " 0 R").join(" ") + "] /Count " + pages.length + " >>";
  objects[fontObjectId] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((pageLines, pageIndex) => {
    const pageObjectId = pageObjectIds[pageIndex];
    const contentObjectId = pageObjectId + 1;
    const drawingLines = pageLines.flatMap((line, index) => index ? ["T*", "(" + escapePdfText(line) + ") Tj"] : ["(" + escapePdfText(line) + ") Tj"]);
    const stream = ["BT", "/F1 8 Tf", "42 800 Td", "11 TL", ...drawingLines, "ET"].join("\n");
    objects[pageObjectId] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 " + fontObjectId + " 0 R >> >> /Contents " + contentObjectId + " 0 R >>";
    objects[contentObjectId] = "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream";
  });
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = Buffer.byteLength(pdf);
    pdf += index + " 0 obj\n" + objects[index] + "\nendobj\n";
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += "xref\n0 " + objects.length + "\n0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index += 1) pdf += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + objects.length + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";
  return new Uint8Array(Buffer.from(pdf, "ascii"));
}

export function createPortalFacilitiesPdfExport(filters: PortalRecordFilters = {}) {
  const result = filterPortalFacilityRecords(filters);
  const records = result.records;
  const summary = getPortalFacilitySummary();
  const lines = [
    "HEFAMAA Portal Facility Index",
    "Generated: " + new Date().toISOString(),
    ...summaryRows(summary).map(([label, value]) => label + ": " + value),
    "Exported matching rows: " + result.totalMatches,
    "Export filters: " + JSON.stringify(filters),
    "",
    "Portal records",
    ...records.flatMap(recordPdfLines),
  ];
  return {
    body: createSimplePdf(lines),
    contentType: "application/pdf",
    filename: "hefamaa-portal-facilities-" + exportTimestamp() + ".pdf",
  };
}
