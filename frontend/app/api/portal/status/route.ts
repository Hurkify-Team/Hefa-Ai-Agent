import { ok, fail } from "@/lib/apiResponse";

export const runtime = "nodejs";

function portalStorageStateSaved() {
  try {
    const { existsSync } = require("node:fs") as typeof import("node:fs");
    const { join } = require("node:path") as typeof import("node:path");
    const dataDir = process.env.HEFAMAA_DATA_DIR?.trim() || process.env.RENDER_DISK_MOUNT_PATH?.trim() || join(process.cwd(), "data");
    return existsSync(join(dataDir, "portal-storage-state.json"));
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    return ok({
      status: "unknown",
      url: null,
      browserChannel: "Controlled Portal Browser",
      persistentProfile: true,
      profileName: "portal-profile",
      storageStateSaved: portalStorageStateSaved(),
      profileLocked: false,
      note: "Portal status is checked during search and capture. Open the portal if search reports that no controlled portal session is active.",
    });
  } catch (error) {
    return fail(error, 500);
  }
}
