import type { TeamRole } from "@/types/auth";

export const teamRoles: TeamRole[] = [
  "Super User",
  "Administrator",
  "Data Officer",
  "Portal Reviewer",
  "Inspector",
  "Front Desk",
  "Read Only",
];

export const rolePermissions: Record<TeamRole, string[]> = {
  "Super User": ["Full AI agent access", "Manage users", "Manage settings", "Run full portal scans", "Clean data", "Export reports", "Save workbook rows", "Send facility notifications"],
  Administrator: ["Manage users", "Manage settings", "Run full portal scans", "Clean data", "Export reports", "Save workbook rows", "Send facility notifications"],
  "Data Officer": ["Capture portal records", "Save workbook rows", "Run duplicate checks", "Search facilities", "Use AI Assistance"],
  "Portal Reviewer": ["Open portal", "Run quick scans", "View portal analytics", "Search facilities", "Use AI Assistance"],
  Inspector: ["View facility records", "Review inspection status", "Export assigned reports", "Use AI Assistance"],
  "Front Desk": ["Help desk cases", "Search facilities", "Ask AI Assistance", "View dashboard"],
  "Read Only": ["View dashboards", "Search facilities", "Ask AI Assistance"],
};

export const roleRouteAccess: Record<TeamRole, string[]> = {
  "Super User": ["*"],
  Administrator: ["*"],
  "Data Officer": [
    "/dashboard",
    "/data-capture",
    "/add-new-facility",
    "/facility-search",
    "/categories",
    "/duplicate-checker",
    "/data-cleaning",
    "/bulk-operations",
    "/reports",
    "/audit-log",
    "/ai-chat",
    "/notifications",
  ],
  "Portal Reviewer": ["/dashboard", "/portal-scan", "/facility-search", "/reports", "/audit-log", "/ai-chat", "/notifications"],
  Inspector: ["/dashboard", "/facility-search", "/reports", "/ai-chat"],
  "Front Desk": ["/dashboard", "/help-desk", "/facility-search", "/ai-chat"],
  "Read Only": ["/dashboard", "/facility-search", "/reports", "/ai-chat"],
};

export function roleCanAccessPath(role: TeamRole, pathname: string) {
  const allowedRoutes = roleRouteAccess[role] ?? [];
  if (allowedRoutes.includes("*")) return true;
  return allowedRoutes.some((route) => pathname === route || pathname.startsWith(route + "/"));
}

export function canManageUsers(role: TeamRole) {
  return role === "Super User" || role === "Administrator";
}
