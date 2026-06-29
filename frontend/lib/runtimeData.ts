import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const defaultDataFolder = "data";
const renderTempDataFolder = "/tmp/hefamaa";

function safeRelativeName(value: string) {
  return path.basename(value.trim()) || "runtime-data.json";
}

function isProductionRuntime() {
  return process.env.NODE_ENV === "production";
}

export function runtimeDataDir() {
  const configured = process.env.HEFAMAA_DATA_DIR?.trim() || process.env.RENDER_DISK_MOUNT_PATH?.trim();
  if (configured && path.isAbsolute(configured)) return configured;
  if (configured) return path.join(/*turbopackIgnore: true*/ process.cwd(), defaultDataFolder, safeRelativeName(configured));
  if (isProductionRuntime()) return renderTempDataFolder;
  return path.join(/*turbopackIgnore: true*/ process.cwd(), defaultDataFolder);
}

export function ensureRuntimeDataDir() {
  const dir = runtimeDataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.info("[runtimeData] Created runtime data directory", { dir });
  }
  return dir;
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
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.info("[runtimeData] Created runtime data directory", { dir, filePath });
  }
}

export function ensureRuntimeJsonFile<T>(filePath: string, fallback: T) {
  ensureRuntimeDataDirForFile(filePath);
  if (!existsSync(filePath)) {
    writeFileSync(filePath, JSON.stringify(fallback, null, 2), "utf8");
    console.info("[runtimeData] Created runtime JSON file", { filePath });
  }
}

export function runtimeDataStatus() {
  const dir = ensureRuntimeDataDir();
  return {
    dataDir: dir,
    dataDirExists: existsSync(dir),
  };
}
