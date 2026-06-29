import { NextResponse } from "next/server";

import { initializeAuthStorage } from "@/lib/auth";
import { listAuditEntries } from "@/lib/auditLog";
import { runtimeDataStatus } from "@/lib/runtimeData";

export const runtime = "nodejs";

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function googleSheetConfigured() {
  return configured("GOOGLE_SHEET_ID") && configured("GOOGLE_SERVICE_ACCOUNT_EMAIL") && configured("GOOGLE_PRIVATE_KEY");
}

export async function GET() {
  console.info("[/api/health] Health check started");

  const storage = runtimeDataStatus();
  const auth = initializeAuthStorage();
  let auditReady = true;
  let auditError: string | null = null;

  try {
    listAuditEntries(1);
  } catch (error) {
    auditReady = false;
    auditError = error instanceof Error ? error.message : "Audit storage failed";
    console.error("[/api/health] Audit storage check failed", error);
  }

  const payload = {
    success: storage.dataDirExists && auth.authReady && auditReady,
    environment: process.env.NODE_ENV || "development",
    dataDirExists: storage.dataDirExists,
    authReady: auth.authReady,
    googleSheetConfigured: googleSheetConfigured(),
    geminiConfigured: configured("GEMINI_API_KEY"),
    portalUrlConfigured: configured("HEFAMAA_PORTAL_URL"),
    auditReady,
    missingAuthEnv: auth.missingEnv,
    auditError,
  };

  console.info("[/api/health] Health check completed", {
    success: payload.success,
    dataDirExists: payload.dataDirExists,
    authReady: payload.authReady,
    googleSheetConfigured: payload.googleSheetConfigured,
    geminiConfigured: payload.geminiConfigured,
    portalUrlConfigured: payload.portalUrlConfigured,
    auditReady: payload.auditReady,
  });

  return NextResponse.json(payload, { status: payload.success ? 200 : 503 });
}
