import type { FieldMappingInput, FieldMappingResult } from "@/types/ai";
import type { SheetRow } from "@/types/sheet";
import { normalizeHeaderName } from "@/lib/normalizers";

const HEADER_ALIASES: Record<string, string[]> = {
  "hef/no": ["HEF/NO", "HEF NO", "Registration Number"],
  "facility name": ["Facility Name", "Name"],
  address: ["Address", "Facility Address"],
  lga: ["LGA", "Local Government"],
  lcda: ["LCDA"],
  "facility e-mail": ["Facility E-Mail", "Facility Email", "Email"],
  "owner's name": ["Owner's Name", "Owner Name", "Proprietor"],
  "owner's address": ["Owner's Address", "Owner Address"],
  contact: ["Contact", "Phone", "Telephone"],
  "scope of service": ["Scope of Service", "Services"],
  "date registered": ["Registration Date", "Date Registered", "Date of Registration"],
  "approval year": ["Approval Year", "Registration Approval Year", "Year of Approval"],
  "renewal year": ["Renewal Year", "Current Renewal"],
};

const STAFF_PROFESSION_ALIASES: Record<string, string[]> = {
  doctor: ["doctor", "doctors", "medical doctor", "medical doctors", "physician", "physicians", "medical officer", "medical officers", "consultant", "consultants"],
  nurse: ["nurse", "nurses", "registered nurse", "registered nurses", "nursing officer", "nursing officers", "rn"],
  midwife: ["midwife", "midwives"],
  "lab sci": ["lab sci", "lab scientist", "lab scientists", "laboratory scientist", "laboratory scientists", "medical laboratory scientist", "medical laboratory scientists", "mls"],
  "lab tech": ["lab tech", "lab technician", "lab technicians", "laboratory technician", "laboratory technicians", "medical laboratory technician", "medical laboratory technicians", "mlt"],
  pharmacist: ["pharmacist", "pharmacists"],
  "pharmacy tech": ["pharmacy tech", "pharmacy technician", "pharmacy technicians", "pharm tech"],
  radiographer: ["radiographer", "radiographers"],
  radiologist: ["radiologist", "radiologists"],
  physiotherapist: ["physiotherapist", "physiotherapists", "physical therapist", "physical therapists"],
  optometrist: ["optometrist", "optometrists"],
  dentist: ["dentist", "dentists", "dental surgeon", "dental surgeons"],
  "dental therapist": ["dental therapist", "dental therapists"],
  "community health officer": ["community health officer", "community health officers", "cho"],
  chew: ["chew", "community health extension worker", "community health extension workers"],
  "health assistant": ["health assistant", "health assistants"],
  "medical record": ["medical record", "medical records", "health record", "health records", "record officer", "records officer"],
  nutritionist: ["nutritionist", "nutritionists", "dietician", "dieticians", "dietitian", "dietitians"],
  sonographer: ["sonographer", "sonographers", "ultrasonographer", "ultrasonographers"],
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function findValue(portalText: string, labels: string[]) {
  for (const label of labels) {
    const pattern = new RegExp(escapeRegex(label) + "\\s*:?\\s*([^\\n]+)", "i");
    const match = portalText.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return null;
}

function normalizeStaffText(value: string) {
  return normalizeHeaderName(value)
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function singularize(value: string) {
  if (value.endsWith("ies")) return value.slice(0, -3) + "y";
  if (value.endsWith("ves")) return value.slice(0, -3) + "f";
  if (value.endsWith("s") && !value.endsWith("ss")) return value.slice(0, -1);
  return value;
}

function tokenMatchesAlias(value: string, alias: string) {
  const normalizedValue = normalizeStaffText(value);
  const normalizedAlias = normalizeStaffText(alias);

  if (!normalizedValue || !normalizedAlias) return false;
  if (normalizedValue === normalizedAlias) return true;
  if (singularize(normalizedValue) === singularize(normalizedAlias)) return true;

  const pattern = new RegExp("(^|\\s)" + escapeRegex(normalizedAlias) + "(s)?($|\\s)");
  return pattern.test(normalizedValue);
}

function professionAliasesForHeader(header: string) {
  const normalizedHeader = normalizeStaffText(header);
  const aliases = new Set<string>();

  for (const professionAliases of Object.values(STAFF_PROFESSION_ALIASES)) {
    const headerMatchesProfession = professionAliases.some((alias) => {
      const normalizedAlias = normalizeStaffText(alias);
      return (
        tokenMatchesAlias(normalizedHeader, normalizedAlias) ||
        normalizedAlias.includes(normalizedHeader) ||
        normalizedHeader.includes(normalizedAlias)
      );
    });

    if (headerMatchesProfession) {
      professionAliases.forEach((alias) => aliases.add(alias));
    }
  }

  if (aliases.size) {
    aliases.add(header);
  }

  return [...aliases];
}

function extractProfessionalStaffSection(portalText: string) {
  const sectionStart = portalText.search(/professional\s+staff|profession\s+staff|staff\s+complement|staffing|personnel/i);

  if (sectionStart === -1) {
    return "";
  }

  const section = portalText.slice(sectionStart);
  const sectionEnd = section.slice(120).search(/\n(?:admin activities|documents?|equipment|facility information|inspection|payment|renewal|scope of service|services?|owner|application)\b/i);

  return sectionEnd === -1 ? section.slice(0, 8000) : section.slice(0, sectionEnd + 120);
}

function rowHasProfession(row: string, aliases: string[]) {
  return aliases.some((alias) => tokenMatchesAlias(row, alias));
}

function explicitSummaryCount(row: string, aliases: string[]) {
  const cells = row.split("|").map((cell) => cell.trim()).filter(Boolean);

  if (cells.length < 2 || cells.length > 3) {
    return null;
  }

  const professionCellIndex = cells.findIndex((cell) => aliases.some((alias) => tokenMatchesAlias(cell, alias)));
  if (professionCellIndex === -1) return null;

  const numberCell = cells.find((cell, index) => index !== professionCellIndex && /^\d{1,3}$/.test(cell));
  return numberCell ? Number(numberCell) : null;
}

function rowsFromStaffSection(section: string) {
  return section
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .filter((line) => !/^(visible tables:?|table \d+:|s\/?n|#|name|profession|designation|qualification|phone|email|status)(\b|\s*\|)/i.test(line));
}

function countRows(rows: string[], aliases: string[]) {
  const tableRows = rows.filter((line) => line.includes("|"));
  const candidateRows = tableRows.some((row) => rowHasProfession(row, aliases)) ? tableRows : rows;

  return candidateRows.reduce((count, row) => {
    if (!rowHasProfession(row, aliases)) {
      return count;
    }

    return count + (explicitSummaryCount(row, aliases) ?? 1);
  }, 0);
}

function countProfessionRows(portalText: string, aliases: string[]) {
  const section = extractProfessionalStaffSection(portalText);

  if (!section) {
    return 0;
  }

  const [bodySection, visibleTablesSection = ""] = section.split(/\nvisible tables:?/i);
  const bodyCount = countRows(rowsFromStaffSection(bodySection), aliases);

  if (bodyCount > 0) {
    return bodyCount;
  }

  return countRows(rowsFromStaffSection(visibleTablesSection), aliases);
}

function applyProfessionalStaffCounts(input: FieldMappingInput, result: FieldMappingResult): FieldMappingResult {
  const matchedFields: SheetRow = { ...result.matchedFields };
  const staffCountNotes: string[] = [];

  for (const header of input.headers) {
    const aliases = professionAliasesForHeader(header);

    if (!aliases.length) {
      continue;
    }

    const count = countProfessionRows(input.portalText, aliases);

    if (count > 0) {
      matchedFields[header] = count;
      staffCountNotes.push(header + "=" + count);
    }
  }

  const missingFields = input.headers.filter((header) => {
    const value = matchedFields[header];
    return value === null || value === undefined || String(value).trim() === "";
  });

  return {
    ...result,
    matchedFields,
    missingFields,
    confidence: input.headers.length
      ? Math.max(result.confidence, (input.headers.length - missingFields.length) / input.headers.length)
      : result.confidence,
    notes: staffCountNotes.length
      ? [...result.notes, "Professional staff complements counted from portal section: " + staffCountNotes.join(", ") + "."]
      : result.notes,
  };
}

function deterministicMapPortalText(input: FieldMappingInput, notes: string[] = []): FieldMappingResult {
  const matchedFields: SheetRow = {};
  const missingFields: string[] = [];

  for (const header of input.headers) {
    const normalized = normalizeHeaderName(header);
    const labels = HEADER_ALIASES[normalized] ?? [header];
    const value = findValue(input.portalText, labels);

    matchedFields[header] = value;
    if (!value) missingFields.push(header);
  }

  const foundCount = input.headers.length - missingFields.length;
  const confidence = input.headers.length ? Math.min(0.95, foundCount / input.headers.length) : 0;

  return applyProfessionalStaffCounts(input, {
    category: input.category,
    matchedFields,
    missingFields,
    confidence,
    notes: notes.length ? notes : ["Deterministic field mapping was used."],
  });
}

export function buildGeminiPrompt(input: FieldMappingInput) {
  return [
    "You are a HEFAMAA facility data extraction assistant.",
    "",
    "Your job is to map visible portal text into the selected Google Sheet category headers.",
    "",
    "Rules:",
    "- Use only the provided sheet headers as output keys.",
    "- The selected category is the active Google Sheet tab. Do not assume LABORATORY fields unless the selected category headers include them.",
    "- Different categories have different headers. Map values only for the current category headers shown below.",
    "- For the portal Professional Staff / Staff Complement section, count visible staff rows by profession and return the numeric complement for any matching provided header. Example: if two rows are Doctors, return 2 for a Doctor/Doctors header; if three rows are Nurses, return 3 for a Nurse/Nurses header.",
    "- Do not invent values.",
    "- If a value is not found, return null.",
    "- If unsure, include it in notes.",
    "- Keep values clean and ready for Google Sheets.",
    "- Do not include fields that are not part of the headers.",
    "- IMPORTANT: Look at the PORTAL RENEWAL CONTEXT and Admin approval evidence sections.",
    "  Use the Registration Approval dates found there to verify the actual status and approval year, especially for facilities that may be stuck in previous renewal cycles.",
    "- Output strict JSON only.",
    "",
    "Input:",
    "Category: " + input.category,
    "",
    "Sheet Headers:",
    input.headers.join("\n"),
    "",
    "Sample Existing Rows:",
    JSON.stringify(input.sampleRows, null, 2),
    "",
    "Visible Portal Text:",
    input.portalText,
    "",
    "Return JSON:",
    "{",
    '  "category": string,',
    '  "matchedFields": object,',
    '  "missingFields": string[],',
    '  "confidence": number,',
    '  "notes": string[]',
    "}",
  ].join("\n");
}

function extractGeminiText(response: unknown) {
  const payload = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{
          text?: string;
        }>;
      };
    }>;
  };

  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
}

function valueFromSourceFields(sourceFields: SheetRow, header: string) {
  if (Object.prototype.hasOwnProperty.call(sourceFields, header)) {
    return sourceFields[header];
  }

  const normalizedHeader = normalizeHeaderName(header);
  const aliasSet = new Set([normalizedHeader, ...(HEADER_ALIASES[normalizedHeader] ?? []).map(normalizeHeaderName)]);

  for (const [sourceKey, sourceValue] of Object.entries(sourceFields)) {
    const normalizedSourceKey = normalizeHeaderName(sourceKey);

    if (normalizedSourceKey === normalizedHeader || aliasSet.has(normalizedSourceKey)) {
      return sourceValue;
    }
  }

  return null;
}

function coerceGeminiResult(input: FieldMappingInput, value: unknown): FieldMappingResult {
  const raw = value as Partial<FieldMappingResult>;
  const sourceFields = raw.matchedFields ?? {};
  const matchedFields: SheetRow = {};
  const missingFields: string[] = [];

  for (const header of input.headers) {
    const fieldValue = valueFromSourceFields(sourceFields, header);
    matchedFields[header] = typeof fieldValue === "string" || typeof fieldValue === "number" ? fieldValue : null;

    if (matchedFields[header] == null || String(matchedFields[header]).trim() === "") {
      missingFields.push(header);
    }
  }

  return {
    category: input.category,
    matchedFields,
    missingFields,
    confidence:
      typeof raw.confidence === "number" && raw.confidence >= 0 && raw.confidence <= 1
        ? raw.confidence
        : input.headers.length
          ? (input.headers.length - missingFields.length) / input.headers.length
          : 0,
    notes: raw.notes?.map(String) ?? ["Gemini returned mapped fields."],
  };
}

async function mapWithGemini(input: FieldMappingInput): Promise<FieldMappingResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    return deterministicMapPortalText(input, ["GEMINI_API_KEY is not configured, so deterministic field mapping was used."]);
  }

  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: buildGeminiPrompt(input),
              },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0,
        },
      }),
    },
  ).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error("Gemini mapping failed: " + (message || response.statusText));
  }

  const text = extractGeminiText(await response.json());

  if (!text) {
    throw new Error("Gemini mapping failed: empty response");
  }

  return applyProfessionalStaffCounts(input, coerceGeminiResult(input, JSON.parse(text)));
}

export async function mapPortalTextToSheetHeaders(input: FieldMappingInput): Promise<FieldMappingResult> {
  try {
    return await mapWithGemini(input);
  } catch (error) {
    return deterministicMapPortalText(input, [
      error instanceof Error ? error.message : "Gemini mapping failed.",
      "Fallback deterministic field mapping was used.",
    ]);
  }
}
