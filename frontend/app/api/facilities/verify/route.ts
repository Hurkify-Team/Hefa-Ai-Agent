import { fail, ok } from "@/lib/apiResponse";
import { extractFacilityNamesFromText, verifyFacilityNames } from "@/lib/facilityVerification";
import { safeRequestJson } from "@/lib/safeJson";

export const runtime = "nodejs";

async function readInput(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const pasted = String(form.get("text") ?? "");
    const names = String(form.get("names") ?? "").split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
    const fileTexts: string[] = [];
    for (const value of form.values()) {
      if (value instanceof File) {
        const text = await value.text().catch(() => "");
        if (/\S/.test(text)) fileTexts.push(text);
      }
    }
    return {
      livePortal: form.get("livePortal") !== "false",
      names: [...names, ...extractFacilityNamesFromText([pasted, ...fileTexts].join("\n"))],
    };
  }

  const body = await safeRequestJson<{ text?: string; names?: string[]; livePortal?: boolean }>(request, "app/api/facilities/verify/route.ts", {});
  return {
    livePortal: body.livePortal !== false,
    names: Array.isArray(body.names) && body.names.length ? body.names : extractFacilityNamesFromText(body.text ?? ""),
  };
}

export async function POST(request: Request) {
  try {
    const input = await readInput(request);
    if (!input.names.length) throw new Error("Provide facility names as pasted text, JSON names, or an uploaded text-based document.");
    return ok(await verifyFacilityNames(input.names, { livePortal: input.livePortal }));
  } catch (error) {
    return fail(error, 500);
  }
}
