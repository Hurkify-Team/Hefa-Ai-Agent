import { existsSync, readFileSync, statSync } from "fs";
import path from "path";

import { fail, ok } from "@/lib/apiResponse";

export const runtime = "nodejs";

type CacheDeps = {
  notificationLogsMtimeMs: number;
  portalListMtimeMs: number;
  portalQaMtimeMs: number;
};


function dataPath(envName: string, fallback: string) {
  const configured = process.env[envName]?.trim() || fallback;
  return path.isAbsolute(configured) ? configured : path.join(process.cwd(), configured);
}

function fileMtimeMs(file: string) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

function compactDashboardCachePath() {
  return dataPath("NOTIFICATION_DASHBOARD_CACHE_PATH", "data/notification-dashboard-cache.json");
}

function compactDashboardDeps(): CacheDeps {
  return {
    notificationLogsMtimeMs: fileMtimeMs(dataPath("NOTIFICATION_LOGS_PATH", "data/notification-logs.json")),
    portalListMtimeMs: fileMtimeMs(dataPath("HEFAMAA_PORTAL_CACHE", "data/portal-facilities-cache.json")),
    portalQaMtimeMs: fileMtimeMs(dataPath("HEFAMAA_PORTAL_QA_INDEX", "data/portal-qa-index.json")),
  };
}

function depsMatch(left: CacheDeps | undefined, right: CacheDeps) {
  if (!left) return false;

  return left.notificationLogsMtimeMs === right.notificationLogsMtimeMs
    && left.portalListMtimeMs === right.portalListMtimeMs
    && left.portalQaMtimeMs === right.portalQaMtimeMs;
}

function readCachedDashboard(deps: CacheDeps) {
  const file = compactDashboardCachePath();
  if (!existsSync(file)) return null;

  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    if (parsed?.version !== 1 || !parsed.dashboard) return null;

    const ageMs = Math.max(0, Date.now() - Number(parsed.createdAtMs || 0));
    const ttlMs = Number(process.env.NOTIFICATION_INTELLIGENCE_CACHE_TTL_MS || 300000);
    const fresh = depsMatch(parsed.deps, deps) && ageMs <= ttlMs;

    return {
      dashboard: {
        ...parsed.dashboard,
        compactCache: {
          ageMs,
          fresh,
          source: "disk",
        },
      },
      fresh,
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const deps = compactDashboardDeps();
    const cached = readCachedDashboard(deps);

    if (cached) return ok(cached.dashboard);

    const { getNotificationDashboard } = await import("@/lib/notificationEngine");
    return ok(getNotificationDashboard({ compact: true }));
  } catch (error) {
    return fail(error, 500);
  }
}
