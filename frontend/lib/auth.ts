import { createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

import type { NextResponse } from "next/server";

import { canManageUsers } from "@/lib/authAccess";
import { configuredRuntimeFile, ensureRuntimeDataDirForFile, ensureRuntimeJsonFile } from "@/lib/runtimeData";
import type { AuthSessionPayload, AuthUser, StoredAuthUser, TeamRole, TeamStatus } from "@/types/auth";

export const authCookieName = "hefamaa_session";
const sessionMaxAgeSeconds = 60 * 60 * 12;
const passwordIterations = 120_000;
const passwordResetMaxAgeMs = 30 * 60_000;

type StoredPasswordReset = {
  createdAt: string;
  email: string;
  expiresAt: string;
  tokenHash: string;
};

type GoogleUserInput = {
  avatarUrl?: string;
  email: string;
  googleSub: string;
  name: string;
};

type CreateUserInput = {
  department?: string;
  email: string;
  name: string;
  password: string;
  role?: TeamRole;
  status?: TeamStatus;
};

function authUsersPath() {
  return configuredRuntimeFile("HEFAMAA_AUTH_USERS_PATH", "auth-users.json");
}

function passwordResetTokensPath() {
  return configuredRuntimeFile("HEFAMAA_AUTH_RESETS_PATH", "auth-password-resets.json");
}

function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    if (!existsSync(filePath)) return fallback;
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile<T>(filePath: string, payload: T) {
  ensureRuntimeDataDirForFile(filePath);
  const tempPath = filePath + ".tmp";
  writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  renameSync(tempPath, filePath);
}

function sessionSecret() {
  return process.env.AUTH_SESSION_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || "hefamaa-local-dev-session-secret-change-me";
}

function readStoredUsers(): StoredAuthUser[] {
  return readJsonFile<StoredAuthUser[]>(authUsersPath(), []);
}

function writeStoredUsers(users: StoredAuthUser[]) {
  writeJsonFile(authUsersPath(), users);
}

function readPasswordResetTokens(): StoredPasswordReset[] {
  return readJsonFile<StoredPasswordReset[]>(passwordResetTokensPath(), []);
}

function writePasswordResetTokens(tokens: StoredPasswordReset[]) {
  writeJsonFile(passwordResetTokensPath(), tokens);
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function adminEnvConfig() {
  const email = process.env.HEFAI_ADMIN_EMAIL?.trim();
  const password = process.env.HEFAI_ADMIN_PASSWORD?.trim();
  const name = process.env.HEFAI_ADMIN_NAME?.trim() || "HEFAI Super User";
  const missing = [
    ["HEFAI_ADMIN_EMAIL", email],
    ["HEFAI_ADMIN_PASSWORD", password],
  ]
    .filter(([, value]) => !value)
    .map(([key]) => key);

  return { email, missing, name, password };
}

export function initializeAuthStorage() {
  const usersPath = authUsersPath();
  const resetsPath = passwordResetTokensPath();
  ensureRuntimeJsonFile<StoredAuthUser[]>(usersPath, []);
  ensureRuntimeJsonFile<StoredPasswordReset[]>(resetsPath, []);

  const users = readJsonFile<StoredAuthUser[]>(usersPath, []);
  if (users.length > 0) {
    console.info("[auth] Auth storage ready", { users: users.length, usersPath });
    return { authReady: true, createdAdmin: false, missingEnv: [] as string[], users: users.length };
  }

  const admin = adminEnvConfig();
  if (admin.missing.length > 0 || !admin.email || !admin.password) {
    console.error("[auth] Auth storage has no users and admin env is incomplete", { missingEnv: admin.missing, usersPath });
    return { authReady: false, createdAdmin: false, missingEnv: admin.missing, users: 0 };
  }

  if (admin.password.length < 8) {
    console.error("[auth] HEFAI_ADMIN_PASSWORD is too short", { usersPath });
    return { authReady: false, createdAdmin: false, missingEnv: ["HEFAI_ADMIN_PASSWORD_MIN_8"], users: 0 };
  }

  const now = new Date().toISOString();
  const { hash, salt } = hashPassword(admin.password);
  const user: StoredAuthUser = {
    createdAt: now,
    department: "Super Administration",
    email: normalizeEmail(admin.email),
    id: "usr_" + randomBytes(8).toString("hex"),
    lastActive: "Created from production env",
    name: admin.name,
    passwordHash: hash,
    passwordIterations,
    passwordSalt: salt,
    role: "Super User",
    status: "active",
    authProvider: "password",
  };

  writeJsonFile(usersPath, [user]);
  console.info("[auth] Created default HEFAI admin user from env", { email: user.email, usersPath });
  return { authReady: true, createdAdmin: true, missingEnv: [] as string[], users: 1 };
}

function requireAuthStorageReady() {
  const status = initializeAuthStorage();
  if (!status.authReady) {
    throw new Error("Production auth is not initialized. Set HEFAI_ADMIN_EMAIL and HEFAI_ADMIN_PASSWORD in Render, then restart the service.");
  }
  return status;
}

function publicUser(user: StoredAuthUser): AuthUser {
  const { passwordHash: _passwordHash, passwordIterations: _passwordIterations, passwordSalt: _passwordSalt, ...safeUser } = user;
  return safeUser;
}

function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const hash = pbkdf2Sync(password, salt, passwordIterations, 64, "sha512").toString("hex");
  return { hash, salt };
}

function verifyPassword(password: string, user: StoredAuthUser) {
  const nextHash = pbkdf2Sync(password, user.passwordSalt, user.passwordIterations, 64, "sha512");
  const savedHash = Buffer.from(user.passwordHash, "hex");
  return savedHash.length === nextHash.length && timingSafeEqual(savedHash, nextHash);
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function signPayload(payload: string) {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

function hashResetToken(token: string) {
  return createHmac("sha256", sessionSecret()).update(token).digest("hex");
}

function secureEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function createSessionToken(user: AuthUser) {
  const payload: AuthSessionPayload = {
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + sessionMaxAgeSeconds,
    role: user.role,
    sub: user.id,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return encodedPayload + "." + signPayload(encodedPayload);
}

function verifySessionToken(token: string | undefined | null): AuthSessionPayload | null {
  if (!token) return null;
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = signPayload(encodedPayload);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as AuthSessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookieHeader(cookieHeader: string | null) {
  const cookies = new Map<string, string>();
  for (const segment of (cookieHeader ?? "").split(";")) {
    const [rawKey, ...rawValue] = segment.trim().split("=");
    if (!rawKey) continue;
    cookies.set(rawKey, decodeURIComponent(rawValue.join("=")));
  }
  return cookies;
}

export function listAuthUsers() {
  requireAuthStorageReady();
  return readStoredUsers().map(publicUser);
}

export function createAuthUser(input: CreateUserInput) {
  initializeAuthStorage();
  const users = readStoredUsers();
  const email = normalizeEmail(input.email);
  if (!email || !input.name.trim()) throw new Error("Name and email are required.");
  if (input.password.length < 8) throw new Error("Password must be at least 8 characters.");
  if (users.some((user) => user.email === email)) throw new Error("A user with this email already exists.");

  const now = new Date().toISOString();
  const firstUser = users.length === 0;
  const { hash, salt } = hashPassword(input.password);
  const user: StoredAuthUser = {
    createdAt: now,
    department: input.department?.trim() || (firstUser ? "Super Administration" : "Front Desk"),
    email,
    id: "usr_" + randomBytes(8).toString("hex"),
    lastActive: "Just now",
    name: input.name.trim(),
    passwordHash: hash,
    passwordIterations,
    passwordSalt: salt,
    role: firstUser ? "Super User" : input.role ?? "Front Desk",
    status: input.status ?? "active",
    authProvider: "password",
  };

  writeStoredUsers([...users, user]);
  return publicUser(user);
}

export function createPasswordResetToken(email: string) {
  const normalizedEmail = normalizeEmail(email);
  const user = readStoredUsers().find((candidate) => candidate.email === normalizedEmail);
  if (!user) throw new Error("No workspace account was found for that email.");

  const token = randomBytes(18).toString("hex").toUpperCase();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + passwordResetMaxAgeMs).toISOString();
  const activeTokens = readPasswordResetTokens().filter((record) => {
    return record.email !== normalizedEmail && new Date(record.expiresAt).getTime() > now.getTime();
  });

  writePasswordResetTokens([
    ...activeTokens,
    {
      createdAt: now.toISOString(),
      email: normalizedEmail,
      expiresAt,
      tokenHash: hashResetToken(token),
    },
  ]);

  return { email: normalizedEmail, expiresAt, token };
}

export function resetAuthUserPassword(email: string, token: string, password: string) {
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");

  const normalizedEmail = normalizeEmail(email);
  const now = Date.now();
  const resets = readPasswordResetTokens();
  const reset = resets
    .filter((record) => record.email === normalizedEmail && new Date(record.expiresAt).getTime() > now)
    .find((record) => secureEqualText(record.tokenHash, hashResetToken(token.trim())));

  if (!reset) throw new Error("Invalid or expired reset code.");

  const users = readStoredUsers();
  const user = users.find((candidate) => candidate.email === normalizedEmail);
  if (!user) throw new Error("No workspace account was found for that email.");

  const { hash, salt } = hashPassword(password);
  user.passwordHash = hash;
  user.passwordSalt = salt;
  user.passwordIterations = passwordIterations;
  user.lastActive = "Password reset";
  writeStoredUsers(users);
  writePasswordResetTokens(resets.filter((record) => record.email !== normalizedEmail));
  return publicUser(user);
}

export function authenticateAuthUser(email: string, password: string) {
  requireAuthStorageReady();
  const users = readStoredUsers();
  const normalizedEmail = normalizeEmail(email);
  const user = users.find((candidate) => candidate.email === normalizedEmail);
  if (!user || !verifyPassword(password, user)) throw new Error("Invalid email or password.");
  if (user.status !== "active") throw new Error("This workspace account is paused. Contact a Super User or Administrator.");

  user.lastActive = "Now";
  writeStoredUsers(users);
  return publicUser(user);
}

export function authenticateGoogleUser(input: GoogleUserInput) {
  initializeAuthStorage();
  const users = readStoredUsers();
  const email = normalizeEmail(input.email);
  const now = new Date().toISOString();
  const existing = users.find((candidate) => candidate.email === email || candidate.googleSub === input.googleSub);

  if (existing) {
    if (existing.status !== "active") throw new Error("This workspace account is paused. Contact a Super User or Administrator.");
    existing.email = email;
    existing.googleSub = input.googleSub;
    existing.authProvider = existing.authProvider ?? "google";
    existing.avatarUrl = input.avatarUrl ?? existing.avatarUrl;
    existing.name = input.name.trim() || existing.name;
    existing.lastActive = "Now";
    writeStoredUsers(users);
    return publicUser(existing);
  }

  const firstUser = users.length === 0;
  const { hash, salt } = hashPassword(randomBytes(24).toString("hex"));
  const user: StoredAuthUser = {
    authProvider: "google",
    avatarUrl: input.avatarUrl,
    createdAt: now,
    department: firstUser ? "Super Administration" : "Front Desk",
    email,
    googleSub: input.googleSub,
    id: "usr_" + randomBytes(8).toString("hex"),
    lastActive: "Now",
    name: input.name.trim() || email.split("@")[0] || "Google User",
    passwordHash: hash,
    passwordIterations,
    passwordSalt: salt,
    role: firstUser ? "Super User" : "Front Desk",
    status: "active",
  };

  writeStoredUsers([...users, user]);
  return publicUser(user);
}

export function updateAuthUser(actor: AuthUser, userId: string, patch: Partial<Pick<AuthUser, "department" | "name" | "role" | "status">>) {
  if (!canManageUsers(actor.role)) throw new Error("You do not have permission to manage users.");
  const users = readStoredUsers();
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error("User not found.");
  if (user.role === "Super User" && actor.role !== "Super User" && patch.role && patch.role !== "Super User") {
    throw new Error("Only a Super User can change another Super User role.");
  }

  if (patch.department !== undefined) user.department = patch.department.trim() || user.department;
  if (patch.name !== undefined) user.name = patch.name.trim() || user.name;
  if (patch.role !== undefined) user.role = patch.role;
  if (patch.status !== undefined) user.status = patch.status;
  writeStoredUsers(users);
  return publicUser(user);
}

export function deleteAuthUser(actor: AuthUser, userId: string) {
  if (!canManageUsers(actor.role)) throw new Error("You do not have permission to manage users.");
  if (actor.id === userId) throw new Error("You cannot remove your own signed-in account.");
  const users = readStoredUsers();
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) throw new Error("User not found.");
  if (user.role === "Super User" && actor.role !== "Super User") throw new Error("Only a Super User can remove another Super User.");
  writeStoredUsers(users.filter((candidate) => candidate.id !== userId));
}

export function getCurrentUserFromRequest(request: Request): AuthUser | null {
  const token = parseCookieHeader(request.headers.get("cookie")).get(authCookieName);
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const user = readStoredUsers().find((candidate) => candidate.id === payload.sub && candidate.email === payload.email);
  if (!user || user.status !== "active") return null;
  return publicUser(user);
}

export function requireCurrentUserFromRequest(request: Request) {
  const user = getCurrentUserFromRequest(request);
  if (!user) throw new Error("Unauthorized");
  return user;
}

export function setAuthSessionCookie(response: NextResponse, user: AuthUser) {
  response.cookies.set(authCookieName, createSessionToken(user), {
    httpOnly: true,
    maxAge: sessionMaxAgeSeconds,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearAuthSessionCookie(response: NextResponse) {
  response.cookies.set(authCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}
