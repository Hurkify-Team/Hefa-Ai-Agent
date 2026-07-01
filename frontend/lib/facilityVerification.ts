import { searchFacilityIndex } from "@/lib/facilitySearchIndex";
import { getPortalFacilityExportRecords, searchFacility } from "@/lib/playwrightPortal";

export type FacilityVerificationRow = {
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

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compact(value: unknown) {
  return normalize(value).replace(/\s+/g, "");
}

function words(value: string) {
  return normalize(value).split(/\s+/).filter((word) => word.length > 2);
}

function similarityScore(query: string, candidate: string) {
  const queryNorm = normalize(query);
  const candidateNorm = normalize(candidate);
  if (!queryNorm || !candidateNorm) return 0;
  if (queryNorm === candidateNorm) return 1;
  if (candidateNorm.includes(queryNorm) || queryNorm.includes(candidateNorm)) return 0.9;
  const queryCompact = compact(query);
  const candidateCompact = compact(candidate);
  if (queryCompact && candidateCompact && (candidateCompact.includes(queryCompact) || queryCompact.includes(candidateCompact))) return 0.86;
  const queryWords = words(query);
  if (!queryWords.length) return 0;
  const hits = queryWords.filter((word) => candidateNorm.includes(word)).length;
  return hits / queryWords.length;
}

export function extractFacilityNamesFromText(text: string) {
  const seen = new Set<string>();
  return text
    .split(/[\n;,]+/)
    .map((line) => clean(line.replace(/^[-*\d.)\s]+/, "")))
    .filter((line) => line.length >= 3 && !/^facility name$/i.test(line))
    .filter((line) => {
      const key = normalize(line);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function bestPortalCacheMatch(name: string) {
  let best: { confidence: number; record: ReturnType<typeof getPortalFacilityExportRecords>[number] } | null = null;
  for (const record of getPortalFacilityExportRecords()) {
    const candidate = record.facilityName || record.visibleFields?.["Facility Name"] || "";
    const confidence = similarityScore(name, candidate);
    if (confidence >= 0.72 && (!best || confidence > best.confidence)) {
      best = { confidence, record };
    }
  }
  return best;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timeout: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<T>((_, reject) => {
      timeout = setTimeout(() => reject(new Error(label + " timed out.")), timeoutMs);
    }),
  ]);
}

async function bestSheetMatch(name: string) {
  const result = await withTimeout(searchFacilityIndex(name, 5), 12_000, "Google Sheet facility search");
  const best = result.results[0];
  if (!best) return null;
  const confidence = Math.max(best.confidence, similarityScore(name, best.facilityName));
  return confidence >= 0.55 ? { confidence, record: best } : null;
}

async function livePortalMatch(name: string) {
  const result = await withTimeout(searchFacility({ facilityName: name }), 20_000, "Live portal facility search");
  if (result.status === "no_match" || result.status === "manual_search_required") {
    return { found: false, result, confidence: 0 };
  }

  const selected = "selectedPortalRecord" in result ? result.selectedPortalRecord : undefined;
  const candidates = Array.isArray(result.matches) ? result.matches : selected ? [selected] : [];
  let best = selected ?? candidates[0];
  let confidence = best ? similarityScore(name, best.facilityName) : 0;

  for (const candidate of candidates) {
    const score = similarityScore(name, candidate.facilityName);
    if (score > confidence) {
      confidence = score;
      best = candidate;
    }
  }

  return { found: Boolean(best && confidence >= 0.55), result, best, confidence };
}

export async function verifyFacilityNames(names: string[], options: { livePortal?: boolean } = {}) {
  const livePortal = options.livePortal !== false;
  const rows: FacilityVerificationRow[] = [];

  for (const rawName of names) {
    const name = clean(rawName);
    if (!name) continue;

    let sheet: Awaited<ReturnType<typeof bestSheetMatch>> = null;
    const notes: string[] = [];
    try {
      sheet = await bestSheetMatch(name);
    } catch (error) {
      notes.push(error instanceof Error ? error.message : "Google Sheet facility search failed.");
    }

    const cache = sheet ? null : bestPortalCacheMatch(name);
    let live: Awaited<ReturnType<typeof livePortalMatch>> | null = null;

    if (!sheet && !cache && livePortal) {
      try {
        live = await livePortalMatch(name);
        if (!live.found && live.result.status === "manual_search_required") notes.push(live.result.note);
      } catch (error) {
        notes.push(error instanceof Error ? error.message : "Live portal verification failed.");
      }
    }

    const liveFound = Boolean(live?.found);
    const verified = Boolean(sheet || cache || liveFound);
    const matchedFacilityName = sheet?.record.facilityName || cache?.record.facilityName || live?.best?.facilityName || "";
    const category = sheet?.record.category || cache?.record.category || live?.best?.category || "";
    const hefNumber = sheet?.record.hefNo || cache?.record.hefamaaId || live?.best?.hefamaaId || "";
    const confidence = Number((sheet?.confidence ?? cache?.confidence ?? live?.confidence ?? 0).toFixed(2));

    if (sheet) notes.push("Matched in Google Sheet database.");
    if (cache) notes.push("Matched in portal scan cache.");
    if (liveFound) notes.push("Matched through live HEFAMAA portal search.");
    if (!verified && !notes.length) notes.push("Not found in Google Sheet, portal cache, or live portal search.");

    rows.push({
      facilityNameFromDocument: name,
      foundInGoogleSheet: sheet ? "Yes" : "No",
      foundInPortalCache: cache ? "Yes" : "No",
      foundInLivePortal: liveFound ? "Yes" : "No",
      finalResult: verified ? "Verified" : "Not Found",
      matchedFacilityName,
      category,
      hefNumber,
      confidence,
      notes: notes.join(" "),
    });
  }

  return {
    rows,
    summary: {
      total: rows.length,
      verified: rows.filter((row) => row.finalResult === "Verified").length,
      notFound: rows.filter((row) => row.finalResult === "Not Found").length,
      livePortalChecked: rows.filter((row) => row.foundInLivePortal === "Yes" || row.notes.includes("Live portal")).length,
    },
  };
}
