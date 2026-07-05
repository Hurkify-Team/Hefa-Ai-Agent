"use client";

import { safeFetchJson } from "@/lib/safeFetchJson";
import { FormEvent, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Database, Download, FileCheck2, FileText, Loader2, Search, ShieldCheck, Upload, XCircle } from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type VerificationRow = {
  facilityNameFromDocument: string;
  foundInGoogleSheet: "Yes" | "No";
  foundInPortalCache: "Yes" | "No";
  foundInLivePortal: "Yes" | "No";
  finalResult: "Verified" | "Not Found";
  matchedFacilityName: string;
  category: string;
  hefNumber: string;
  confidence: number;
  notes: string;
};

type VerificationResponse = {
  rows: VerificationRow[];
  summary: { total: number; verified: number; notFound: number; livePortalChecked: number };
  warnings?: string[];
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const result = await safeFetchJson<ApiResult<T>>(url, init);
  if (!result.ok) throw new Error(result.status === 502 ? "Service temporarily unavailable" : result.error);
  if (!result.data.ok) throw new Error(result.data.error);
  return result.data.data;
}

function exportTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function escapePdfText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "?")
    .replace(/([\\()])/g, "\\$1");
}

function wrapLine(value: string, width = 104) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!line) line = word;
    else if ((line + " " + word).length <= width) line += " " + word;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

function createSimplePdf(lines: string[]) {
  const pageLineLimit = 50;
  const pages: string[][] = [];
  for (let index = 0; index < lines.length; index += pageLineLimit) pages.push(lines.slice(index, index + pageLineLimit));
  if (!pages.length) pages.push(["No verification rows found."]);

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
    objects[contentObjectId] = "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream";
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = pdf.length;
    pdf += index + " 0 obj\n" + objects[index] + "\nendobj\n";
  }
  const xrefOffset = pdf.length;
  pdf += "xref\n0 " + objects.length + "\n0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index += 1) pdf += String(offsets[index]).padStart(10, "0") + " 00000 n \n";
  pdf += "trailer\n<< /Size " + objects.length + " /Root 1 0 R >>\nstartxref\n" + xrefOffset + "\n%%EOF";
  return new Uint8Array(Array.from(pdf, (character) => character.charCodeAt(0)));
}

function verificationPdfLines(result: VerificationResponse) {
  const lines = [
    "HEFAMAA Facility Verification Report",
    "Generated: " + new Date().toLocaleString(),
    "Total names checked: " + result.summary.total,
    "Verified: " + result.summary.verified,
    "Not found: " + result.summary.notFound,
    "Live portal checks: " + result.summary.livePortalChecked,
    "",
    "Verification results",
  ];

  result.rows.forEach((row, index) => {
    const primary = (index + 1) + ". " + row.facilityNameFromDocument + " | Result: " + row.finalResult + " | Confidence: " + Math.round(row.confidence * 100) + "%";
    const secondary = "Sheet: " + row.foundInGoogleSheet + " | Cache: " + row.foundInPortalCache + " | Live Portal: " + row.foundInLivePortal;
    const match = "Matched: " + (row.matchedFacilityName || "-") + " | Category: " + (row.category || "-") + " | HEF Number: " + (row.hefNumber || "-");
    const notes = "Notes: " + (row.notes || "-");
    lines.push(...wrapLine(primary), ...wrapLine(secondary), ...wrapLine(match), ...wrapLine(notes), "");
  });

  if (result.warnings?.length) {
    lines.push("Document warnings");
    for (const warning of result.warnings) lines.push(...wrapLine("- " + warning));
  }

  return lines;
}

function Stat({ label, value, tone = "blue" }: { label: string; value: number | string; tone?: "blue" | "green" | "red" | "slate" }) {
  const tones = {
    blue: "border-blue-100 bg-blue-50 text-blue-900",
    green: "border-emerald-100 bg-emerald-50 text-emerald-900",
    red: "border-red-100 bg-red-50 text-red-900",
    slate: "border-slate-200 bg-white text-slate-900",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${tones[tone]}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-2 text-[26px] font-semibold tracking-[-0.02em]">{value}</p>
    </div>
  );
}

function SourceStep({ icon: Icon, title, text }: { icon: typeof Database; title: string; text: string }) {
  return (
    <div className="rounded-2xl border border-blue-100 bg-white/85 p-4 shadow-sm">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-[14px] font-semibold text-slate-950">{title}</h3>
      <p className="mt-1 text-[12px] font-medium leading-5 text-slate-500">{text}</p>
    </div>
  );
}

function YesNoBadge({ value }: { value: "Yes" | "No" }) {
  if (value === "Yes") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" />Yes</span>;
  }
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-500"><XCircle className="h-3.5 w-3.5" />No</span>;
}

export default function FacilityVerificationPage() {
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [useLivePortal, setUseLivePortal] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [result, setResult] = useState<VerificationResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rows = result?.rows ?? [];
  const tableRows = useMemo(() => rows, [rows]);
  const canVerify = Boolean(text.trim() || file) && !isVerifying;

  function exportPdf() {
    if (!result || !result.rows.length) {
      setMessage("Run verification first before exporting the PDF report.");
      return;
    }

    const pdf = createSimplePdf(verificationPdfLines(result));
    const blob = new Blob([pdf], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "hefamaa-facility-verification-" + exportTimestamp() + ".pdf";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsVerifying(true);
    setMessage(null);

    try {
      let response: VerificationResponse;
      if (file) {
        const form = new FormData();
        form.append("text", text);
        form.append("livePortal", String(useLivePortal));
        form.append("file", file);
        response = await fetchApi<VerificationResponse>("/api/facilities/verify", { method: "POST", body: form });
      } else {
        response = await fetchApi<VerificationResponse>("/api/facilities/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, livePortal: useLivePortal }),
        });
      }
      setResult(response);
      setMessage(response.warnings?.length ? response.warnings.join(" ") : "Verification completed. Only confirmed matches are marked Yes.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to verify facilities.");
    } finally {
      setIsVerifying(false);
    }
  }

  return (
    <AppShell>
      <section className="min-h-screen space-y-6 bg-[#f5f8fc] px-4 py-6 text-slate-900 xl:px-6 2xl:px-8">
        <div className="overflow-hidden rounded-[28px] border border-blue-100 bg-white shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div className="grid gap-6 p-6 lg:grid-cols-[1.2fr_0.8fr] lg:p-8">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-blue-700">
                <ShieldCheck className="h-3.5 w-3.5" /> Facility Verification Intelligence
              </div>
              <h1 className="mt-4 text-[30px] font-semibold tracking-[-0.03em] text-slate-950 lg:text-[36px]">Verify Facility Names</h1>
              <p className="mt-3 max-w-3xl text-[14px] font-medium leading-6 text-slate-600">Validate pasted names or uploaded documents against the active workbook, portal cache, and the live HEFAMAA portal only when a record is unresolved. HEFAI never guesses a match.</p>
              <div className="mt-6 grid gap-3 sm:grid-cols-3">
                <SourceStep icon={Database} title="Workbook First" text="Checks active Google Sheet or Excel workbook records before any live portal action." />
                <SourceStep icon={FileText} title="Portal Cache" text="Uses stored portal scan records for fast confirmation where available." />
                <SourceStep icon={Search} title="Live Fallback" text="Searches the live portal only for names not found in trusted local sources." />
              </div>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.12em] text-slate-500">Verification Status</p>
                  <p className="mt-1 text-[20px] font-semibold text-slate-950">{isVerifying ? "Checking records" : result ? "Report ready" : "Ready to verify"}</p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20">
                  {isVerifying ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileCheck2 className="h-5 w-5" />}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Stat label="Total" value={result?.summary.total ?? "-"} tone="slate" />
                <Stat label="Verified" value={result?.summary.verified ?? "-"} tone="green" />
                <Stat label="Not Found" value={result?.summary.notFound ?? "-"} tone="red" />
                <Stat label="Live Checked" value={result?.summary.livePortalChecked ?? "-"} tone="blue" />
              </div>
            </div>
          </div>
        </div>

        <form className="grid gap-6 xl:grid-cols-[420px_1fr]" onSubmit={verify}>
          <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[18px] font-semibold text-slate-950">Verification Input</h2>
                <p className="mt-1 text-[13px] font-medium text-slate-500">Paste names or upload a supported document.</p>
              </div>
              <Upload className="h-5 w-5 text-blue-600" />
            </div>
            <textarea className="mt-5 min-h-[280px] w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-[13px] font-medium leading-6 text-slate-800 outline-none transition focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50" placeholder="Paste facility names, one per line" value={text} onChange={(event) => setText(event.target.value)} />
            <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-2xl border border-dashed border-blue-200 bg-blue-50/70 p-4 text-[13px] font-semibold text-blue-800 transition hover:border-blue-300 hover:bg-blue-50">
              <span className="flex min-w-0 items-center gap-2"><Upload className="h-4 w-4 shrink-0" /><span className="truncate">{file ? file.name : "Upload PDF, Word, CSV, or text file"}</span></span>
              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700">Browse</span>
              <input className="hidden" type="file" accept=".txt,.csv,.pdf,.doc,.docx" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
            </label>
            <label className="mt-4 flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-[13px] font-medium text-slate-700">
              <input className="mt-0.5 h-4 w-4 accent-blue-600" checked={useLivePortal} type="checkbox" onChange={(event) => setUseLivePortal(event.target.checked)} />
              <span><span className="font-semibold text-slate-950">Use live portal fallback</span><br />Only unresolved names will be checked against the logged-in portal session.</span>
            </label>
            <button className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 text-[13px] font-semibold text-white shadow-lg shadow-blue-600/20 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60" disabled={!canVerify} type="submit">
              {isVerifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileCheck2 className="h-4 w-4" />}
              {isVerifying ? "Verifying facilities..." : "Run Verification"}
            </button>
            {message ? <p className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-[13px] font-medium leading-5 text-amber-900">{message}</p> : null}
          </section>

          <section className="space-y-5">
            <div className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
                <div>
                  <h2 className="text-[18px] font-semibold text-slate-950">Verification Report</h2>
                  <p className="mt-1 text-[13px] font-medium text-slate-500">Confirmed sources, matched identity, confidence, and notes.</p>
                </div>
                <button className="inline-flex h-10 items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 text-[12px] font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={!result?.rows.length} onClick={exportPdf} type="button">
                  <Download className="h-4 w-4" /> Export PDF
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1120px] text-left text-[12px]">
                  <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">
                    <tr>{["Facility Name From Document", "Google Sheet", "Portal Cache", "Live Portal", "Final Result", "Matched Facility Name", "Category", "HEF Number", "Confidence", "Notes"].map((head) => <th className="px-4 py-3" key={head}>{head}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {tableRows.map((row, index) => (
                      <tr className="align-top transition hover:bg-blue-50/30" key={row.facilityNameFromDocument + index}>
                        <td className="px-4 py-3 font-semibold text-slate-950">{row.facilityNameFromDocument}</td>
                        <td className="px-4 py-3"><YesNoBadge value={row.foundInGoogleSheet} /></td>
                        <td className="px-4 py-3"><YesNoBadge value={row.foundInPortalCache} /></td>
                        <td className="px-4 py-3"><YesNoBadge value={row.foundInLivePortal} /></td>
                        <td className="px-4 py-3"><span className={row.finalResult === "Verified" ? "inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700" : "inline-flex rounded-full bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700"}>{row.finalResult}</span></td>
                        <td className="px-4 py-3 font-medium text-slate-800">{row.matchedFacilityName || "-"}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{row.category || "-"}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{row.hefNumber || "-"}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{Math.round(row.confidence * 100)}%</td>
                        <td className="max-w-[280px] px-4 py-3 font-medium leading-5 text-slate-600">{row.notes || "-"}</td>
                      </tr>
                    ))}
                    {!tableRows.length ? <tr><td className="px-4 py-12 text-center text-[13px] font-medium text-slate-500" colSpan={10}><AlertTriangle className="mx-auto mb-2 h-6 w-6 text-slate-400" />No verification report yet. Add names or upload a document, then run verification.</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        </form>
      </section>
    </AppShell>
  );
}
