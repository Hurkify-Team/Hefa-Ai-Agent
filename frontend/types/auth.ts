export type TeamRole = "Super User" | "Administrator" | "Data Officer" | "Portal Reviewer" | "Inspector" | "Front Desk" | "Read Only";

export type TeamStatus = "active" | "paused";

export type AuthUser = {
  createdAt: string;
  department: string;
  email: string;
  id: string;
  lastActive: string;
  name: string;
  role: TeamRole;
  status: TeamStatus;
  authProvider?: "password" | "google";
  avatarUrl?: string;
};

export type StoredAuthUser = AuthUser & {
  passwordHash: string;
  passwordIterations: number;
  passwordSalt: string;
  googleSub?: string;
};

export type AuthSessionPayload = {
  email: string;
  exp: number;
  role: TeamRole;
  sub: string;
};
