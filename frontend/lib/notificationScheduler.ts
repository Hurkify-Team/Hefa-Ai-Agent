import { listNotificationRules } from "@/lib/notificationRules";

export function getDueNotificationRules(now = new Date()) {
  const day = now.getDay();
  const date = now.getDate();
  return listNotificationRules().filter((rule) => {
    if (!rule.is_active) return false;
    if (rule.frequency === "manual") return false;
    if (rule.frequency === "daily") return true;
    if (rule.frequency === "weekly") return day === 1;
    if (rule.frequency === "monthly") return date === 1;
    return false;
  });
}

export function schedulerSummary() {
  const rules = listNotificationRules();
  return {
    activeRules: rules.filter((rule) => rule.is_active).length,
    dueRulesToday: getDueNotificationRules().length,
    totalRules: rules.length,
  };
}
