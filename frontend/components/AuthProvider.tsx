"use client";

import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LockKeyhole, ShieldAlert } from "lucide-react";

import { roleCanAccessPath } from "@/lib/authAccess";
import type { AuthUser } from "@/types/auth";

type SessionPayload = {
  authenticated: boolean;
  permissions: string[];
  routeAccess: string[];
  user?: AuthUser;
};

type AuthContextValue = {
  canAccessPath: (pathname: string) => boolean;
  loading: boolean;
  permissions: string[];
  refreshSession: () => Promise<void>;
  signOut: () => Promise<void>;
  user: AuthUser | null;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function readSession(): Promise<SessionPayload> {
  const response = await fetch("/api/auth/session", { cache: "no-store" });
  const payload = await response.json();
  return payload.data ?? { authenticated: false, permissions: [], routeAccess: [] };
}

function LoadingShell() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f8fb] px-4">
      <div className="w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-[0_24px_90px_rgba(15,23,42,0.12)]">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
          <LockKeyhole className="h-5 w-5 animate-pulse" />
        </span>
        <p className="mt-4 text-[15px] font-black text-slate-950">Checking workspace session</p>
        <p className="mt-1 text-[12px] font-semibold text-slate-500">HEFAMAA Smart Registry Agent</p>
      </div>
    </div>
  );
}

function AccessDenied({ user, signOut }: { signOut: () => Promise<void>; user: AuthUser }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f8fb] px-4">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-7 shadow-[0_24px_90px_rgba(15,23,42,0.12)]">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 ring-1 ring-amber-100">
          <ShieldAlert className="h-5 w-5" />
        </span>
        <h1 className="mt-5 text-[24px] font-black tracking-[-0.03em] text-slate-950">This role cannot open this section</h1>
        <p className="mt-2 text-[13px] font-semibold leading-6 text-slate-600">
          {user.name} is signed in as {user.role}. A Super User or Administrator can update this role from Users & Roles.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link className="rounded-xl bg-blue-600 px-4 py-2 text-[13px] font-black text-white hover:bg-blue-700" href="/dashboard">
            Go to dashboard
          </Link>
          <button className="rounded-xl border border-slate-200 px-4 py-2 text-[13px] font-black text-slate-700 hover:bg-slate-50" onClick={() => void signOut()} type="button">
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<SessionPayload>({ authenticated: false, permissions: [], routeAccess: [] });
  const [loading, setLoading] = useState(true);

  const refreshSession = useCallback(async () => {
    setLoading(true);
    try {
      setSession(await readSession());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (!loading && !session.authenticated) {
      router.replace("/sign-in?next=" + encodeURIComponent(pathname));
    }
  }, [loading, pathname, router, session.authenticated]);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST" });
    setSession({ authenticated: false, permissions: [], routeAccess: [] });
    router.replace("/sign-in");
  }, [router]);

  const canAccessPath = useCallback((nextPath: string) => {
    if (!session.user) return false;
    return roleCanAccessPath(session.user.role, nextPath);
  }, [session.user]);

  const contextValue = useMemo<AuthContextValue>(() => ({
    canAccessPath,
    loading,
    permissions: session.permissions,
    refreshSession,
    signOut,
    user: session.user ?? null,
  }), [canAccessPath, loading, refreshSession, session.permissions, session.user, signOut]);

  if (loading || !session.authenticated || !session.user) return <LoadingShell />;

  if (!roleCanAccessPath(session.user.role, pathname)) {
    return (
      <AuthContext.Provider value={contextValue}>
        <AccessDenied signOut={signOut} user={session.user} />
      </AuthContext.Provider>
    );
  }

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthGate.");
  return context;
}
