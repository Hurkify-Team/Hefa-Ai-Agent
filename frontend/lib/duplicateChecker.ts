import type { DuplicateCheckResult, DuplicateMatch } from "@/types/facility";
import type { SheetRow } from "@/types/sheet";
import {
  compareFacilitySimilarity,
  normalizeEmail,
  normalizeFacilityName,
  normalizeHeaderName,
  normalizePhoneNumber,
} from "@/lib/normalizers";

const FIELD_ALIASES = {
  hefNo: ["HEF/NO", "HEF NO", "HEFAMAA NO", "HF NO", "REG NO", "Registration Number", "Registration No"],
  facilityName: ["Facility Name", "FACILITY NAME", "Name", "Name of Facility", "Facility"],
  address: ["Address", "ADDRESS", "Facility Address", "Location"],
  contact: ["Contact", "Phone", "Phone Number", "Phone No", "PHONE NO", "Telephone", "Mobile"],
  email: ["Facility E-Mail", "Facility Email", "Email", "E-Mail", "E-MAIL"],
};

function normalizedHeaderLookup(row: SheetRow) {
  return new Map(Object.entries(row).map(([key, value]) => [normalizeHeaderName(key), value] as const));
}

function valueFor(row: SheetRow, fields: string[]) {
  const lookup = normalizedHeaderLookup(row);

  for (const field of fields) {
    const directValue = row[field];
    if (directValue !== undefined && directValue !== null && String(directValue).trim()) {
      return String(directValue).trim();
    }

    const normalizedValue = lookup.get(normalizeHeaderName(field));
    if (normalizedValue !== undefined && normalizedValue !== null && String(normalizedValue).trim()) {
      return String(normalizedValue).trim();
    }
  }

  return "";
}

function sameHefNo(left: string, right: string) {
  return left.trim().toLowerCase() === right.trim().toLowerCase();
}

export function checkDuplicateFacility(values: SheetRow, existingRows: SheetRow[]): DuplicateCheckResult {
  const matches: DuplicateMatch[] = [];
  const incomingHefNo = valueFor(values, FIELD_ALIASES.hefNo);
  const incomingName = valueFor(values, FIELD_ALIASES.facilityName);
  const incomingAddress = valueFor(values, FIELD_ALIASES.address);
  const incomingContact = normalizePhoneNumber(valueFor(values, FIELD_ALIASES.contact));
  const incomingEmail = normalizeEmail(valueFor(values, FIELD_ALIASES.email));

  existingRows.forEach((row, rowIndex) => {
    const reasons: string[] = [];
    let score = 0;

    const hefNo = valueFor(row, FIELD_ALIASES.hefNo);
    if (incomingHefNo && hefNo && sameHefNo(incomingHefNo, hefNo)) {
      score += 0.45;
      reasons.push("HEF/NO matched");
    }

    const existingName = valueFor(row, FIELD_ALIASES.facilityName);
    const nameSimilarity = compareFacilitySimilarity(incomingName, existingName);
    if (nameSimilarity >= 0.82) {
      score += nameSimilarity * 0.25;
      reasons.push("Facility name is similar");
    }

    const existingAddress = valueFor(row, FIELD_ALIASES.address);
    const addressSimilarity = compareFacilitySimilarity(incomingAddress, existingAddress);
    if (addressSimilarity >= 0.78) {
      score += addressSimilarity * 0.15;
      reasons.push("Address is similar");
    }

    const contact = normalizePhoneNumber(valueFor(row, FIELD_ALIASES.contact));
    if (incomingContact && contact && incomingContact === contact) {
      score += 0.1;
      reasons.push("Contact matched");
    }

    const email = normalizeEmail(valueFor(row, FIELD_ALIASES.email));
    if (incomingEmail && email && incomingEmail === email) {
      score += 0.05;
      reasons.push("Email matched");
    }

    if (score >= 0.55) {
      matches.push({
        rowIndex,
        score: Number(score.toFixed(2)),
        reasons,
        row: { ...row },
      });
    }
  });

  matches.sort((a, b) => b.score - a.score);

  const best = matches[0];
  const bestHefNo = best ? valueFor(best.row, FIELD_ALIASES.hefNo) : "";
  const bestName = best ? valueFor(best.row, FIELD_ALIASES.facilityName) : "";
  const exactByIdentity =
    Boolean(incomingHefNo) &&
    Boolean(bestHefNo) &&
    sameHefNo(incomingHefNo, bestHefNo) &&
    normalizeFacilityName(bestName) === normalizeFacilityName(incomingName);

  return {
    status: best && (best.score >= 0.9 || exactByIdentity) ? "exact_duplicate" : best ? "possible_duplicate" : "no_duplicate",
    matches,
  };
}
