import { existsSync, readFileSync, writeFileSync } from "fs";

import { configuredRuntimeFile, ensureRuntimeDataDirForFile } from "@/lib/runtimeData";

export type ConversationMemory = {
  lastCategory?: string | null;
  lastFacilityName?: string | null;
  lastIntent?: string | null;
  lastLGA?: string | null;
  lastResultSet?: Array<Record<string, unknown>>;
  updatedAt?: string;
};

type MemoryStore = Record<string, ConversationMemory>;

const globalMemory = globalThis as typeof globalThis & { __hefaiConversationMemory?: MemoryStore };

globalMemory.__hefaiConversationMemory ??= {};

function memoryPath() {
  return configuredRuntimeFile("HEFAI_MEMORY_PATH", "conversation-memory.json");
}

function readDiskStore(): MemoryStore {
  const file = memoryPath();
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeDiskStore(store: MemoryStore) {
  const file = memoryPath();
  ensureRuntimeDataDirForFile(file);
  writeFileSync(file, JSON.stringify(store, null, 2), "utf8");
}

export function getConversationMemory(sessionId = "default") {
  const inMemory = globalMemory.__hefaiConversationMemory?.[sessionId];
  if (inMemory) return inMemory;
  const disk = readDiskStore();
  globalMemory.__hefaiConversationMemory = { ...globalMemory.__hefaiConversationMemory, ...disk };
  return globalMemory.__hefaiConversationMemory[sessionId] ?? {};
}

export function updateConversationMemory(sessionId: string | undefined, patch: ConversationMemory) {
  const id = sessionId || "default";
  const current = getConversationMemory(id);
  const next: ConversationMemory = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    lastResultSet: patch.lastResultSet?.slice(0, 25) ?? current.lastResultSet,
  };

  globalMemory.__hefaiConversationMemory = {
    ...globalMemory.__hefaiConversationMemory,
    [id]: next,
  };

  // This is intentionally tiny and local. It lets a follow-up question like
  // “how many are pending?” reuse the last category/LGA without involving a user DB.
  writeDiskStore(globalMemory.__hefaiConversationMemory);
  return next;
}
