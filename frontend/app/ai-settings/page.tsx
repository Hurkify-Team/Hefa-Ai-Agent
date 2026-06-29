"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Bot, CheckCircle2, FileText, Loader2, Save, SlidersHorizontal, Zap } from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };
type ConfigStatus = "configured" | "missing" | "error";
type SettingsStatus = {
  health: {
    gemini: { status: ConfigStatus; message: string; model: string };
    googleWorkbook: { status: ConfigStatus; message: string };
    portal: { status: ConfigStatus; message: string; url: string };
  };
};
type GeminiTestResult = { status?: number; success: boolean; error?: string; data?: unknown };
type ResponseMode = "fast" | "balanced" | "deep";

type AiPreferences = {
  defaultSources: string[];
  responseMode: ResponseMode;
  sheetTimeoutSeconds: number;
  strictJson: boolean;
};

const storageKey = "hefamaa-ai-preferences";
const defaultPreferences: AiPreferences = {
  defaultSources: ["portal", "sheets"],
  responseMode: "fast",
  sheetTimeoutSeconds: 5,
  strictJson: true,
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "app/ai-settings/page.tsx"));
  if (!payload.ok) throw new Error(payload.error);
  return payload.data;
}

function loadPreferences() {
  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return defaultPreferences;
    return { ...defaultPreferences, ...(JSON.parse(saved) as Partial<AiPreferences>) };
  } catch {
    return defaultPreferences;
  }
}

function statusClass(status?: ConfigStatus) {
  if (status === "configured") return "bg-blue-50 text-blue-700 ring-blue-100";
  if (status === "error") return "bg-rose-50 text-rose-700 ring-rose-100";
  return "bg-amber-50 text-amber-700 ring-amber-100";
}

export default function AiSettingsPage() {
  const [settings, setSettings] = useState<SettingsStatus | null>(null);
  const [preferences, setPreferences] = useState<AiPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [geminiResult, setGeminiResult] = useState<GeminiTestResult | null>(null);

  useEffect(() => {
    setPreferences(loadPreferences());
    void loadSettings();
  }, []);

  const activeSourceLabel = useMemo(() => {
    if (preferences.defaultSources.length === 2) return "Portal scan + workbook fallback";
    if (preferences.defaultSources.includes("portal")) return "Portal scan cache";
    return "Active + old workbook databases";
  }, [preferences.defaultSources]);

  async function loadSettings() {
    setIsLoading(true);
    setError(null);
    try {
      setSettings(await fetchApi<SettingsStatus>("/api/settings/status"));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load AI settings");
    } finally {
      setIsLoading(false);
    }
  }

  async function testGemini() {
    setIsTesting(true);
    setGeminiResult(null);
    try {
      const response = await fetch("/api/test-gemini", { cache: "no-store" });
      setGeminiResult((await safeJsonResponse<GeminiTestResult>(response, "app/ai-settings/page.tsx")));
    } catch (testError) {
      setGeminiResult({ success: false, error: testError instanceof Error ? testError.message : "Unable to test Gemini" });
    } finally {
      setIsTesting(false);
    }
  }

  function savePreferences() {
    window.localStorage.setItem(storageKey, JSON.stringify(preferences));
    setMessage("AI preferences saved for this local workspace.");
  }

  function toggleSource(source: string) {
    setPreferences((current) => {
      const exists = current.defaultSources.includes(source);
      const nextSources = exists
        ? current.defaultSources.filter((item) => item !== source)
        : [...current.defaultSources, source];
      return { ...current, defaultSources: nextSources.length ? nextSources : [source] };
    });
  }

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">AI Settings</h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Configure Gemini checks, AI Assistance source routing, and response speed preferences.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-[13px] font-black text-slate-700 disabled:opacity-60"
              disabled={isTesting}
              onClick={() => void testGemini()}
              type="button"
            >
              {isTesting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
              Test Gemini
            </button>
            <button className="flex h-10 items-center gap-2 rounded-xl bg-blue-600 px-4 text-[13px] font-black text-white hover:bg-blue-700" onClick={savePreferences} type="button">
              <Save className="h-4 w-4" />
              Save
            </button>
          </div>
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-bold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}
        {message ? <p className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] font-bold text-blue-800">{message}</p> : null}

        <div className="grid gap-5 xl:grid-cols-[0.85fr_1.15fr]">
          <section className="space-y-4">
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[12px] font-black uppercase tracking-[0.06em] text-slate-400">Gemini model</p>
                  <h2 className="mt-2 text-[22px] font-black text-slate-950">{settings?.health.gemini.model ?? "Loading..."}</h2>
                  <p className="mt-2 text-[13px] font-semibold leading-6 text-slate-600">{settings?.health.gemini.message ?? "Checking Gemini configuration."}</p>
                </div>
                <span className={["rounded-full px-3 py-1 text-[11px] font-black ring-1", statusClass(settings?.health.gemini.status)].join(" ")}>{settings?.health.gemini.status ?? "loading"}</span>
              </div>
            </article>

            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Bot className="h-5 w-5 text-blue-600" />
                <h2 className="text-[17px] font-black text-slate-950">Connection Test</h2>
              </div>
              {geminiResult ? (
                <div className={geminiResult.success ? "rounded-xl border border-blue-100 bg-blue-50 p-4" : "rounded-xl border border-rose-100 bg-rose-50 p-4"}>
                  <p className={geminiResult.success ? "text-[13px] font-black text-blue-800" : "text-[13px] font-black text-rose-800"}>
                    {geminiResult.success ? "Gemini API is responding." : "Gemini API test failed."}
                  </p>
                  <p className="mt-1 text-[12px] font-semibold text-slate-600">HTTP status: {geminiResult.status ?? "n/a"}</p>
                  {geminiResult.error ? <p className="mt-2 text-[12px] font-semibold text-rose-700">{geminiResult.error}</p> : null}
                </div>
              ) : (
                <p className="text-[13px] font-semibold leading-6 text-slate-600">Run a quick server-side Gemini test without exposing the API key in the browser.</p>
              )}
            </article>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-5 flex items-center gap-2">
              <SlidersHorizontal className="h-5 w-5 text-blue-600" />
              <h2 className="text-[17px] font-black text-slate-950">AI Assistance Behavior</h2>
            </div>

            <div className="space-y-5">
              <div>
                <p className="text-[12px] font-black text-slate-700">Response mode</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {(["fast", "balanced", "deep"] as ResponseMode[]).map((mode) => (
                    <button
                      className={[
                        "h-11 rounded-xl border px-3 text-[13px] font-black capitalize transition",
                        preferences.responseMode === mode ? "border-blue-200 bg-blue-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:text-blue-700",
                      ].join(" ")}
                      key={mode}
                      onClick={() => setPreferences((current) => ({ ...current, responseMode: mode }))}
                      type="button"
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-[12px] font-black text-slate-700">Default data sources</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {[{ key: "portal", label: "Portal scan cache" }, { key: "sheets", label: "Active + old databases" }].map((source) => (
                    <button
                      className={[
                        "flex h-12 items-center justify-between rounded-xl border px-3 text-[13px] font-black transition",
                        preferences.defaultSources.includes(source.key) ? "border-blue-200 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-600 hover:bg-blue-50",
                      ].join(" ")}
                      key={source.key}
                      onClick={() => toggleSource(source.key)}
                      type="button"
                    >
                      {source.label}
                      {preferences.defaultSources.includes(source.key) ? <CheckCircle2 className="h-4 w-4" /> : null}
                    </button>
                  ))}
                </div>
                <p className="mt-2 text-[12px] font-semibold text-slate-500">Current mode: {activeSourceLabel}. HEF/NO questions always route to spreadsheet lookup first.</p>
              </div>

              <label className="block text-[12px] font-black text-slate-700">
                Workbook timeout target
                <input
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-semibold outline-none focus:border-blue-300 focus:ring-4 focus:ring-blue-50"
                  max={20}
                  min={3}
                  onChange={(event) => setPreferences((current) => ({ ...current, sheetTimeoutSeconds: Number(event.target.value) }))}
                  type="number"
                  value={preferences.sheetTimeoutSeconds}
                />
              </label>

              <button
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 text-[13px] font-black text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                onClick={() => setPreferences((current) => ({ ...current, strictJson: !current.strictJson }))}
                type="button"
              >
                <FileText className="h-4 w-4" />
                Structured JSON mapping: {preferences.strictJson ? "Enabled" : "Disabled"}
              </button>

              <Link className="flex h-11 items-center justify-center rounded-xl bg-blue-600 text-[13px] font-black text-white hover:bg-blue-700" href="/ai-chat">
                Open AI Assistance
              </Link>
            </div>
          </section>
        </div>

        {isLoading ? (
          <p className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-bold text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading AI settings...
          </p>
        ) : null}
      </section>
    </AppShell>
  );
}
