import { mkdirSync } from "node:fs";
import path from "node:path";

const defaultDataFolder = "data";

function safeRelativeName(value: string) {
  return path.basename(value.trim()) || "runtime-data.json";
}

export function runtimeDataDir() {
  const configured = process.env.HEFAMAA_DATA_DIR?.trim() || process.env.RENDER_DISK_MOUNT_PATH?.trim();
  if (configured && path.isAbsolute(configured)) return configured;
  if (configured) return path.join(/*turbopackIgnore: true*/ process.cwd(), defaultDataFolder, safeRelativeName(configured));
  return path.join(/*turbopackIgnore: true*/ process.cwd(), defaultDataFolder);
}

export function runtimeDataFile(filename: string) {
  return runtimeDataDir().replace(/[\/]+$/, "") + "/" + safeRelativeName(filename);
}

export function configuredRuntimeFile(envName: string, fallbackFilename: string) {
  const configured = process.env[envName]?.trim();
  if (!configured) return runtimeDataFile(fallbackFilename);
  return path.isAbsolute(configured) ? configured : runtimeDataFile(configured);
}

export function ensureRuntimeDataDirForFile(filePath: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
}
