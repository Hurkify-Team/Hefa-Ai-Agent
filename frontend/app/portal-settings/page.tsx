"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Globe2, Loader2, RefreshCw, Save, Search, ShieldCheck } from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type ConfigStatus = "configured" | "missing" | "error";
type SettingsStatus = { health: { portal: { status: ConfigStatus; message: string; url: string } } };
type PortalStatus = {
  browserChannel: string;
  note: string;
  persistentProfile: boolean;
  profileLocked: boolean;
  profileLockPid?: number;
  profileName: string;
  status: "active" | "opening" | "closed";
  url: string | null;
};
type PortalPreferences = {
  captureYear: number;
  latestYearOnly: boolean;
  branchDetection: boolean;
  fastOpen: boolean;
};

const storageKey = "hefamaa-portal-preferences";
const defaultPreferences: PortalPreferences = {
  captureYear: 2026,
  latestYearOnly: true,
  branchDetection: true,
  fastOpen: true,
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "app/portal-settings/page.tsx"));
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

function loadPreferences() {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return defaultPreferences;
    return { ...defaultPreferences, ...(JSON.parse(saved) as Partial<PortalPreferences>) };
  } catch {
    return defaultPreferences;
  }
}

function statusClasses(status?: string) {
  if (status === "active" || status === "configured") return "bg-blue-50 text-blue-700 ring-blue-100";
  if (status === "opening") return "bg-amber-50 text-amber-700 ring-amber-100";
  if (status === "error") return "bg-rose-50 text-rose-700 ring-rose-100";
  return "bg-slate-100 text-slate-600 ring-slate-200";
}

export default function PortalSettingsPage() {
  const [settings, setSettings] = useState<SettingsStatus | null>(null);
  const [status, setStatus] = useState<PortalStatus | null>(null);
  const [preferences, setPreferences] = useState<PortalPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = useState(true);
  const [isOpening, setIsOpening] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPreferences(loadPreferences());
    void refreshAll();
  }, []);

  async function refreshAll() {
    setIsLoading(true);
    setError(null);
    try {
      const [nextSettings, nextStatus] = await Promise.all([
        fetchApi<SettingsStatus>("/api/settings/status"),
        fetchApi<PortalStatus>("/api/portal/status"),
      ]);
      setSettings(nextSettings);
      setStatus(nextStatus);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load portal settings");
    } finally {
      setIsLoading(false);
    }
  }

  async function openPortal() {
    setIsOpening(true);
    setError(null);
    setMessage(null);
    try {
      await fetchApi<unknown>("/api/portal/open", { method: "POST" });
      setMessage("Portal browser launch requested. Use the dedicated HEFAMAA portal window to log in if required.");
      await refreshAll();
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "Unable to open portal");
    } finally {
      setIsOpening(false);
    }
  }

  function savePreferences() {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
    setMessage("Portal capture preferences saved for this workspace.");
  }

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">Portal Settings</h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Control HEFAMAA portal connection, current-year capture logic, and portal scan behavior.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-black text-slate-700 disabled:opacity-60" disabled={isLoading} onClick={() => void refreshAll()} type="button">
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Refresh
            </button>
            <button className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-[13px] font-black text-white hover:bg-blue-700 disabled:opacity-60" disabled={isOpening} onClick={() => void openPortal()} type="button">
              {isOpening ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe2 className="h-4 w-4" />}
              Open Portal
            </button>
          </div>
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3 text-[13px] font-bold text-rose-800">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}
        {message ? <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] font-bold text-blue-800">{message}</p> : null}

        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="space-y-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-black uppercase tracking-[0.06em] text-slate-400">Portal URL</p>
                  <h2 className="mt-2 break-all text-[18px] font-black text-slate-950">{settings?.health.portal.url ?? "Loading..."}</h2>
                  <p className="mt-2 text-[13px] font-semibold leading-6 text-slate-600">{settings?.health.portal.message ?? "Checking portal URL."}</p>
                </div>
                <span className={["rounded-full px-3 py-1 text-[11px] font-black ring-1", statusClasses(settings?.health.portal.status)].join(" ")}>{settings?.health.portal.status ?? "loading"}</span>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-blue-600" />
                <h2 className="text-[17px] font-black text-slate-950">Browser Session</h2>
              </div>
              <dl className="space-y-3 text-[13px]">
                {[
                  ["Status", status?.status ?? "loading"],
                  ["Current URL", status?.url ?? "Not open"],
                  ["Browser", status?.browserChannel ?? "Unknown"],
                  ["Profile", status?.profileName ?? "Unknown"],
                  ["Profile lock", status?.profileLocked ? "Locked" : "Clear"],
                ].map(([label, value]) => (
                  <div className="grid grid-cols-[110px_1fr] gap-3" key={label}>
                    <dt className="font-bold text-slate-500">{label}</dt>
                    <dd className="break-words font-black text-slate-950">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 rounded-xl bg-slate-50 p-3 text-[12px] font-semibold leading-5 text-slate-600">{status?.note ?? "Loading portal status."}</p>
            </article>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-2">
              <Search className="h-5 w-5 text-blue-600" />
              <h2 className="text-[17px] font-black text-slate-950">Capture Logic</h2>
            </div>
            <div className="space-y-5">
              <label className="block text-[12px] font-black text-slate-700">
                Current portal renewal year
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                  max={2099}
                  min={2020}
                  onChange={(event) => setPreferences((current) => ({ ...current, captureYear: Number(event.target.value) }))}
                  type="number"
                  value={preferences.captureYear}
                />
              </label>

              <button
                className={[
                  "flex h-12 w-full items-center justify-between rounded-xl border px-4 text-left text-[13px] font-black transition",
                  preferences.latestYearOnly ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600",
                ].join(" ")}
                onClick={() => setPreferences((current) => ({ ...current, latestYearOnly: !current.latestYearOnly }))}
                type="button"
              >
                Capture most recent year only
                {preferences.latestYearOnly ? <CheckCircle2 className="h-4 w-4" /> : null}
              </button>

              <button
                className={[
                  "flex h-12 w-full items-center justify-between rounded-xl border px-4 text-left text-[13px] font-black transition",
                  preferences.branchDetection ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600",
                ].join(" ")}
                onClick={() => setPreferences((current) => ({ ...current, branchDetection: !current.branchDetection }))}
                type="button"
              >
                Detect annex and branch records
                {preferences.branchDetection ? <CheckCircle2 className="h-4 w-4" /> : null}
              </button>

              <button
                className={[
                  "flex h-12 w-full items-center justify-between rounded-xl border px-4 text-left text-[13px] font-black transition",
                  preferences.fastOpen ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600",
                ].join(" ")}
                onClick={() => setPreferences((current) => ({ ...current, fastOpen: !current.fastOpen }))}
                type="button"
              >
                Prefer fast portal reopen
                {preferences.fastOpen ? <CheckCircle2 className="h-4 w-4" /> : null}
              </button>

              <button className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-blue-600 text-[13px] font-black text-white hover:bg-blue-700" onClick={savePreferences} type="button">
                <Save className="h-4 w-4" />
                Save portal preferences
              </button>

              <div className="grid gap-2 sm:grid-cols-2">
                <Link className="flex h-11 items-center justify-center rounded-xl border border-slate-200 text-[13px] font-black text-slate-700 hover:bg-blue-50" href="/portal-scan">
                  Portal scan monitor
                </Link>
                <Link className="flex h-11 items-center justify-center rounded-xl border border-slate-200 text-[13px] font-black text-slate-700 hover:bg-blue-50" href="/data-capture">
                  Data capture
                </Link>
              </div>
            </div>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
