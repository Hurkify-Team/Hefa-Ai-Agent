import { NextResponse } from "next/server";

import { initializeAuthStorage } from "@/lib/auth";
import { listAuditEntries } from "@/lib/auditLog";
import { assertGoogleSheetsConfigured, readSheetTabs } from "@/lib/googleSheets";
import { memorySnapshot } from "@/lib/memory";
import { runtimeDataStatus } from "@/lib/runtimeData";

export const runtime = "nodejs";

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

export async function GET() {
  console.info("START:", "/api/health");

  const errors: Record<string, string> = {};
  const checks = {
    googleSheets: false,
    gemini: false,
    auth: false,
    storage: false,
    notifications: false,
    playwright: false,
  };

  try {
    const storage = runtimeDataStatus();
    checks.storage = storage.dataDirExists;
  } catch (error) {
    errors.storage = errorMessage(error);
    console.error("ERROR:", "/api/health storage failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
  }

  try {
    const auth = initializeAuthStorage();
    checks.auth = auth.authReady;
    if (!auth.authReady) errors.auth = "Auth admin env is missing or invalid";
  } catch (error) {
    errors.auth = errorMessage(error);
    console.error("ERROR:", "/api/health auth failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
  }

  try {
    listAuditEntries(1);
  } catch (error) {
    errors.audit = errorMessage(error);
    console.error("ERROR:", "/api/health audit failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
  }

  try {
    assertGoogleSheetsConfigured();
    await readSheetTabs();
    checks.googleSheets = true;
  } catch (error) {
    errors.googleSheets = errorMessage(error);
    console.error("ERROR:", "/api/health googleSheets failed", error instanceof Error ? { message: error.message, stack: error.stack } : error);
  }

  checks.gemini = configured("GEMINI_API_KEY");
  if (!checks.gemini) errors.gemini = "GEMINI_API_KEY is not configured";

  checks.notifications = configured("SMTP_HOST") || configured("RESEND_API_KEY") || configured("TERMII_API_KEY") || configured("GMAIL_SMTP_USER");
  if (!checks.notifications) errors.notifications = "Notification provider is not configured";

  checks.playwright = configured("HEFAMAA_PORTAL_URL");
  if (!checks.playwright) errors.playwright = "HEFAMAA_PORTAL_URL is not configured";

  const success = Object.values(checks).every(Boolean);
  const memory = memorySnapshot();
  const services = {
    googleSheetsConfigured: checks.googleSheets,
    geminiConfigured: checks.gemini,
    portalConfigured: checks.playwright,
    storageReady: checks.storage,
  };
  console.info("SUCCESS:", "/api/health completed", { success, checks, memory });

  return NextResponse.json(
    {
      success,
      status: success ? "healthy" : "degraded",
      environment: process.env.NODE_ENV || "development",
      memory: {
        heapUsedMB: memory.heapUsedMB,
        heapTotalMB: memory.heapTotalMB,
        rssMB: memory.rssMB,
      },
      services,
      checks,
      errors,
      googleSheetsReady: checks.googleSheets,
      googleSheetConfigured: checks.googleSheets,
      geminiConfigured: checks.gemini,
      portalUrlConfigured: checks.playwright,
    },
    { status: success ? 200 : 503 },
  );
}
