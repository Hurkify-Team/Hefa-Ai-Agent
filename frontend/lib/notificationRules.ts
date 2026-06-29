import { existsSync, readFileSync, writeFileSync } from "fs";

import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";
import { z } from "zod";

export const notificationRuleSchema = z.object({
  category: z.string().optional().default(""),
  channel: z.array(z.enum(["email", "sms"])).default(["email"]),
  condition_field: z.string().default("requirements_status"),
  condition_operator: z.enum(["equals", "contains", "missing", "older_than_days"]).default("contains"),
  condition_value: z.string().default("pending"),
  created_at: z.string().optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "manual"]).default("weekly"),
  id: z.string().optional(),
  is_active: z.boolean().default(true),
  lga: z.string().optional().default(""),
  rule_name: z.string().min(1).default("Pending requirements reminder"),
  template_id: z.string().default("pending_requirements_email"),
  trigger_type: z.enum(["pending_requirements", "expired_accreditation", "missing_documents", "inspection_issue", "incomplete_record", "general_notice"]).default("pending_requirements"),
});

export type NotificationRule = z.infer<typeof notificationRuleSchema>;

type RuleStore = { rules: NotificationRule[] };

const DEFAULT_RULES: NotificationRule[] = [
  {
    category: "",
    channel: ["email", "sms"],
    condition_field: "requirements_status",
    condition_operator: "contains",
    condition_value: "pending",
    created_at: "2026-06-11T00:00:00.000Z",
    frequency: "weekly",
    id: "rule-pending-requirements",
    is_active: true,
    lga: "",
    rule_name: "Pending requirements reminder",
    template_id: "pending_requirements_email",
    trigger_type: "pending_requirements",
  },
];

function rulesPath() {
  return configuredRuntimeFile("NOTIFICATION_RULES_PATH", "notification-rules.json");
}

function readStore(): RuleStore {
  const file = rulesPath();
  if (!existsSync(file)) return { rules: DEFAULT_RULES };
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return { rules: Array.isArray(parsed.rules) ? parsed.rules.map((rule: unknown) => notificationRuleSchema.parse(rule)) : DEFAULT_RULES };
  } catch {
    return { rules: DEFAULT_RULES };
  }
}

function writeStore(store: RuleStore) {
  const file = rulesPath();
  ensureRuntimeDataDirForFile(file);
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

export function listNotificationRules() {
  return readStore().rules;
}

export function saveNotificationRule(rawRule: unknown) {
  const rule = notificationRuleSchema.parse(rawRule);
  const store = readStore();
  const id = rule.id || "rule-" + Date.now().toString(36);
  const next = { ...rule, created_at: rule.created_at || new Date().toISOString(), id };
  const index = store.rules.findIndex((item) => item.id === id);
  if (index >= 0) store.rules[index] = next;
  else store.rules.unshift(next);
  writeStore(store);
  return next;
}
