import { fail, ok } from "@/lib/apiResponse";
import { extractFacilityNamesFromText, verifyFacilityNames } from "@/lib/facilityVerification";
import { safeRequestJson } from "@/lib/safeJson";

export const runtime = "nodejs";

type VerificationInput = {
  livePortal: boolean;
  names: string[];
  warnings: string[];
};

async function readInput(request: Request): Promise<VerificationInput> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const pasted = String(form.get("text") ?? "");
    const names = String(form.get("names") ?? "").split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
    const fileTexts: string[] = [];
    const warnings: string[] = [];

    const { extractTextFromUploadedFile } = await import("@/lib/documentTextExtraction");

    for (const value of form.values()) {
      if (value instanceof File && value.size > 0) {
        try {
          const extracted = await extractTextFromUploadedFile(value);
          if (/\S/.test(extracted.text)) fileTexts.push(extracted.text);
          warnings.push(...extracted.warnings);
        } catch (error) {
          warnings.push(value.name + " could not be read: " + (error instanceof Error ? error.message : "Unknown document parsing error"));
        }
      }
    }

    return {
      livePortal: form.get("livePortal") !== "false",
      names: [...names, ...extractFacilityNamesFromText([pasted, ...fileTexts].join("\n"))],
      warnings,
    };
  }

  const body = await safeRequestJson<{ text?: string; names?: string[]; livePortal?: boolean }>(request, "app/api/facilities/verify/route.ts", {});
  return {
    livePortal: body.livePortal !== false,
    names: Array.isArray(body.names) && body.names.length ? body.names : extractFacilityNamesFromText(body.text ?? ""),
    warnings: [],
  };
}

export async function POST(request: Request) {
  try {
    const input = await readInput(request);
    if (!input.names.length) throw new Error("Provide facility names as pasted text, JSON names, or an uploaded PDF, DOCX, CSV, or text document with selectable text.");
    const result = await verifyFacilityNames(input.names, { livePortal: input.livePortal });
    return ok({ ...result, warnings: input.warnings });
  } catch (error) {
    return fail(error, 500);
  }
}
