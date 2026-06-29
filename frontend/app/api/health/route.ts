import { NextResponse } from "next/server";

import { initializeAuthStorage } from "@/lib/auth";
import { listAuditEntries } from "@/lib/auditLog";
import { assertGoogleSheetsConfigured, readSheetTabs } from "@/lib/googleSheets";
import { runtimeDataStatus } from "@/lib/runtimeData";

export const runtime = "nodejs";

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

export async function GET() {
  console.info("[/api/health] Health check started");

  const storage = runtimeDataStatus();
  const auth = initializeAuthStorage();
  let auditReady = true;
  let auditError: string | null = null;
  let googleSheetsReady = true;
  let googleSheetsError: string | null = null;

  try {
    listAuditEntries(1);
  } catch (error) {
    auditReady = false;
    auditError = error instanceof Error ? error.message : "Audit storage failed";
    console.error("[/api/health] Audit storage check failed", error);
  }

  try {
    assertGoogleSheetsConfigured();
    await readSheetTabs();
  } catch (error) {
    googleSheetsReady = false;
    googleSheetsError = error instanceof Error ? error.message : "Google Sheets configuration missing or invalid";
    console.error("[/api/health] Google Sheets readiness check failed", error);
  }

  const payload = {
    success: storage.dataDirExists && auth.authReady && auditReady && googleSheetsReady,
    environment: process.env.NODE_ENV || "development",
    dataDirExists: storage.dataDirExists,
    authReady: auth.authReady,
    googleSheetConfigured: googleSheetsReady,
    googleSheetsReady,
    googleSheetsError,
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
    googleSheetsReady: payload.googleSheetsReady,
    geminiConfigured: payload.geminiConfigured,
    portalUrlConfigured: payload.portalUrlConfigured,
    auditReady: payload.auditReady,
  });

  return NextResponse.json(payload, { status: payload.success ? 200 : 503 });
}
