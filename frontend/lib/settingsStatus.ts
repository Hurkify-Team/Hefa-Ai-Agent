import { readSheetTabs } from "@/lib/googleSheets";

type ConfigStatus = "configured" | "missing" | "error";

export type SettingsStatusItem = {
  label: string;
  envName: string;
  configured: boolean;
  value: string;
  status: ConfigStatus;
  note: string;
};

export type SettingsHealth = {
  googleWorkbook: {
    status: ConfigStatus;
    message: string;
    tabCount?: number;
  };
  gemini: {
    status: ConfigStatus;
    message: string;
    model: string;
  };
  portal: {
    status: ConfigStatus;
    message: string;
    url: string;
  };
  auditDatabase: {
    status: ConfigStatus;
    message: string;
  };
};

export type SettingsStatus = {
  items: SettingsStatusItem[];
  health: SettingsHealth;
  rules: Array<{
    label: string;
    value: string;
    note: string;
  }>;
};

function envValue(name: string) {
  return process.env[name]?.trim() ?? "";
}

function maskValue(value: string, visibleStart = 8, visibleEnd = 4) {
  const cleanValue = value.replace(/^["']|["']$/g, "");

  if (!cleanValue) {
    return "Not configured";
  }

  if (cleanValue.length <= visibleStart + visibleEnd + 4) {
    return `${cleanValue.slice(0, 2)}...${cleanValue.slice(-2)}`;
  }

  return `${cleanValue.slice(0, visibleStart)}...${cleanValue.slice(-visibleEnd)}`;
}

function configuredItem(label: string, envName: string, note: string, options?: { mask?: boolean; secret?: boolean }) {
  const value = envValue(envName);
  const configured = Boolean(value);

  return {
    label,
    envName,
    configured,
    value: configured
      ? options?.secret
        ? "Configured (hidden)"
        : options?.mask === false
          ? value
          : maskValue(value)
      : "Not configured",
    status: configured ? "configured" : "missing",
    note,
  } satisfies SettingsStatusItem;
}

export async function getSettingsStatus(): Promise<SettingsStatus> {
  const cacheTtlMs = Number(envValue("SHEET_CACHE_TTL_MS"));
  const resolvedCacheTtlMs = Number.isFinite(cacheTtlMs) && cacheTtlMs >= 0 ? cacheTtlMs : 60_000;
  const items = [
    configuredItem("Active Google Sheet / Drive File ID", "GOOGLE_SHEET_ID", "The main HEFAMAA Active Database workbook file ID or URL."),
    configuredItem("Old Google Sheet / Drive File ID", "OLD_GOOGLE_SHEET_ID", "Optional read-only Old Hefamaa Database workbook file ID or URL for fallback lookup.", {
      mask: false,
    }),
    configuredItem("Service Account Email", "GOOGLE_SERVICE_ACCOUNT_EMAIL", "Must have Editor access to the workbook.", {
      mask: false,
    }),
    configuredItem("Google Private Key", "GOOGLE_PRIVATE_KEY", "Used server-side only for Google API authentication.", {
      secret: true,
    }),
    configuredItem("Gemini API Key", "GEMINI_API_KEY", "Used server-side only for AI field mapping.", {
      secret: true,
    }),
    configuredItem("Gemini Model", "GEMINI_MODEL", "Optional model override. Defaults to gemini-3.5-flash.", {
      mask: false,
    }),
    configuredItem("Portal URL", "HEFAMAA_PORTAL_URL", "HEFAMAA portal entry point used by Playwright.", {
      mask: false,
    }),
    configuredItem(
      "Portal Storage State",
      "HEFAMAA_PORTAL_STORAGE_STATE",
      "Optional local file for saved portal login cookies. Defaults to data/portal-storage-state.json.",
      {
        mask: false,
      },
    ),
    configuredItem(
      "Portal Legacy Profile",
      "HEFAMAA_PORTAL_PROFILE_DIR",
      "Optional legacy profile folder used only for stale-lock cleanup. Defaults to data/portal-profile.",
      {
        mask: false,
      },
    ),
    configuredItem("Audit Database", "DATABASE_URL", "Local SQLite database path for audit logs.", {
      mask: false,
    }),
  ];

  let workbookHealth: SettingsHealth["googleWorkbook"] = {
    status: "missing",
    message: "Google workbook settings are incomplete.",
  };

  if (
    envValue("GOOGLE_SHEET_ID") &&
    envValue("GOOGLE_SERVICE_ACCOUNT_EMAIL") &&
    envValue("GOOGLE_PRIVATE_KEY")
  ) {
    try {
      const tabs = await readSheetTabs();
      workbookHealth = {
        status: "configured",
        message: `Connected to workbook with ${tabs.length} categories.`,
        tabCount: tabs.length,
      };
    } catch (error) {
      workbookHealth = {
        status: "error",
        message: error instanceof Error ? error.message : "Unable to verify Google workbook connection.",
      };
    }
  }

  const geminiKey = envValue("GEMINI_API_KEY");
  const portalUrl = envValue("HEFAMAA_PORTAL_URL");
  const databaseUrl = envValue("DATABASE_URL") || "file:./data/audit.db";

  return {
    items,
    health: {
      googleWorkbook: workbookHealth,
      gemini: {
        status: geminiKey ? "configured" : "missing",
        message: geminiKey ? "Gemini key is configured. Use Test Gemini to verify live access." : "Gemini key is missing.",
        model: envValue("GEMINI_MODEL") || "gemini-3.5-flash",
      },
      portal: {
        status: portalUrl ? "configured" : "missing",
        message: portalUrl ? "Portal URL is configured for Playwright automation." : "Portal URL is missing.",
        url: portalUrl || "Not configured",
      },
      auditDatabase: {
        status: databaseUrl ? "configured" : "missing",
        message: `Audit log database: ${databaseUrl}`,
      },
    },
    rules: [
      {
        label: "Workbook Cache",
        value: `${resolvedCacheTtlMs} ms`,
        note: "Short server-side cache for faster dashboard, reports, search, and settings reads.",
      },
      {
        label: "Duplicate Matching Fields",
        value: "HEF/NO, Facility Name, Address, Contact, Email",
        note: "Exact duplicates block normal save and route the user to update instead.",
      },
      {
        label: "Missing Field Behavior",
        value: "Leave blank",
        note: "Missing portal values stay blank unless the user edits the preview before saving.",
      },
      {
        label: "Save Confirmation",
        value: "Preview required",
        note: "The app never writes to the workbook automatically after capture.",
      },
      {
        label: "Portal Security",
        value: "Manual login with persistent local session",
        note: "The agent reuses the local browser profile but does not store portal passwords or bypass HEFAMAA security.",
      },
    ],
  };
}
