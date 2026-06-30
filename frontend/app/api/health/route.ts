import { existsSync, mkdirSync } from "node:fs";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function configured(name: string) {
  return Boolean(process.env[name]?.trim());
}

function runtimeDataDir() {
  return process.env.HEFAMAA_DATA_DIR?.trim() || process.env.RENDER_DISK_MOUNT_PATH?.trim() || (process.env.NODE_ENV === "production" ? "/tmp/hefamaa" : process.cwd() + "/data");
}

function memory() {
  const usage = process.memoryUsage();
  const mb = (value: number) => Math.round((value / 1024 / 1024) * 10) / 10;
  return {
    heapUsedMB: mb(usage.heapUsed),
    heapTotalMB: mb(usage.heapTotal),
    rssMB: mb(usage.rss),
  };
}

export async function GET() {
  console.log("[/api/health] started");

  try {
    const dataDir = runtimeDataDir();
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

    const services = {
      storageReady: existsSync(dataDir),
      googleSheetsConfigured: configured("GOOGLE_SHEET_ID") && configured("GOOGLE_SERVICE_ACCOUNT_EMAIL") && configured("GOOGLE_PRIVATE_KEY"),
      geminiConfigured: configured("GEMINI_API_KEY"),
      portalConfigured: configured("HEFAMAA_PORTAL_URL"),
    };

    return NextResponse.json({
      success: true,
      status: "healthy",
      environment: process.env.NODE_ENV || "development",
      memory: memory(),
      services,
      checks: {
        storage: services.storageReady,
        googleSheets: services.googleSheetsConfigured,
        gemini: services.geminiConfigured,
        playwright: services.portalConfigured,
      },
    });
  } catch (error) {
    console.error("[/api/health] failed", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Health check failed",
        stack: process.env.NODE_ENV === "development" && error instanceof Error ? error.stack : undefined,
      },
      { status: 500 },
    );
  }
}
