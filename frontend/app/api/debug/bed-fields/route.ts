import { NextResponse } from "next/server";

import { readPortalDetailsCacheLightweight, type LightweightPortalFacilityDetailRecord } from "@/lib/portalCacheStore";

type BedKey = "admissionBeds" | "observationBeds" | "couches";

const BED_ALIASES: Record<BedKey, string[]> = {
  admissionBeds: ["Admission Bed", "Admission Beds", "ADMISSION BEDS", "No of Admission Beds"],
  observationBeds: ["Observation Bed", "Observation Beds", "OBSERVATION BEDS", "No of Observation Beds"],
  couches: ["No of Couches", "Couches", "COUCHES", "Number of Couches"],
};

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalize(value: unknown) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseBedNumber(value: unknown) {
  if (isNumber(value)) return Math.max(0, Math.trunc(value));
  const text = clean(value);
  if (!text || /^(n\/?a|not applicable|null|nil|none|-|—)$/i.test(text)) return null;
  const match = text.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function fieldValue(detail: LightweightPortalFacilityDetailRecord, aliases: string[]) {
  const sources = [detail.bedDistribution, detail.fieldIndex, detail.visibleFields].filter(Boolean) as Array<Record<string, unknown>>;
  const aliasTokens = aliases.map(normalize);
  for (const source of sources) {
    for (const [key, value] of Object.entries(source)) {
      const keyToken = normalize(key);
      if (aliasTokens.some((alias) => keyToken === alias || keyToken.includes(alias) || alias.includes(keyToken))) {
        const cleaned = clean(value);
        if (cleaned) return cleaned;
      }
    }
  }
  return "";
}

function bedValue(detail: LightweightPortalFacilityDetailRecord, key: BedKey) {
  const direct = detail[key];
  if (isNumber(direct)) return direct;
  const nested = detail.bedDistribution?.[key];
  if (isNumber(nested)) return nested;
  return parseBedNumber(fieldValue(detail, BED_ALIASES[key]));
}

export async function GET() {
  console.log("[/api/debug/bed-fields] started");
  try {
    const details = readPortalDetailsCacheLightweight();
    let facilitiesWithAdmissionBeds = 0;
    let facilitiesWithObservationBeds = 0;
    let facilitiesWithCouches = 0;
    let totalAdmissionBeds = 0;
    let totalObservationBeds = 0;
    let totalCouches = 0;

    const sampleFacilities = [];

    for (const detail of details) {
      const admissionBeds = bedValue(detail, "admissionBeds");
      const observationBeds = bedValue(detail, "observationBeds");
      const couches = bedValue(detail, "couches");

      if (admissionBeds !== null) {
        facilitiesWithAdmissionBeds += 1;
        totalAdmissionBeds += admissionBeds;
      }
      if (observationBeds !== null) {
        facilitiesWithObservationBeds += 1;
        totalObservationBeds += observationBeds;
      }
      if (couches !== null) {
        facilitiesWithCouches += 1;
        totalCouches += couches;
      }

      if (sampleFacilities.length < 20 && (admissionBeds !== null || observationBeds !== null || couches !== null)) {
        sampleFacilities.push({
          facilityName: detail.facilityName,
          hefNo: detail.hefamaaId,
          category: detail.category,
          admissionBeds,
          observationBeds,
          couches,
          capturedAt: detail.capturedAt,
          sourceUrl: detail.url,
        });
      }
    }

    return NextResponse.json({
      success: true,
      totalFacilities: details.length,
      facilitiesWithAdmissionBeds,
      facilitiesWithObservationBeds,
      facilitiesWithCouches,
      totalAdmissionBeds,
      totalObservationBeds,
      totalCouches,
      missingAdmissionBeds: details.length - facilitiesWithAdmissionBeds,
      missingObservationBeds: details.length - facilitiesWithObservationBeds,
      missingCouches: details.length - facilitiesWithCouches,
      sampleFacilities,
    });
  } catch (error) {
    console.error("[/api/debug/bed-fields] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unable to inspect bed fields",
        stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
