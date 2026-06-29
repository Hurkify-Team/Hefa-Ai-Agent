import { safeApi } from "@/lib/apiResponse";
import { logMemory } from "@/lib/memory";
import { getNotificationDashboard } from "@/lib/notificationEngine";

export const runtime = "nodejs";

export async function POST() {
  return safeApi("/api/notifications/refresh-targets", async () => {
    logMemory("/api/notifications/refresh-targets start");
    const dashboard = getNotificationDashboard({ compact: true });
    logMemory("/api/notifications/refresh-targets end");
    return {
      refreshed: true,
      hefamaaAttentionCount: dashboard.intelligence.hefamaaAttentionCount,
      reminderQueueCount: dashboard.intelligence.reminderQueueCount,
      staleCacheCount: dashboard.intelligence.staleCacheCount,
    };
  });
}
