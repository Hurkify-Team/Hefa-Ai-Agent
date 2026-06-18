"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Database,
  FileKey2,
  Globe2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";

import { AppShell } from "@/components/AppShell";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type ConfigStatus = "configured" | "missing" | "error";

type SettingsStatus = {
  items: Array<{
    label: string;
    envName: string;
    configured: boolean;
    value: string;
    status: ConfigStatus;
    note: string;
  }>;
  health: {
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
  rules: Array<{
    label: string;
    value: string;
    note: string;
  }>;
};

type GeminiTestResult = {
  status?: number;
  success: boolean;
  error?: string;
  data?: unknown;
};

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await response.json()) as ApiResult<T>;

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function statusClasses(status: ConfigStatus) {
  if (status === "configured") {
    return "bg-blue-100 text-blue-800";
  }

  if (status === "error") {
    return "bg-rose-100 text-rose-800";
  }

  return "bg-amber-100 text-amber-800";
}

function StatusBadge({ status }: { status: ConfigStatus }) {
  const Icon = status === "configured" ? CheckCircle2 : AlertTriangle;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${statusClasses(status)}`}>
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [geminiResult, setGeminiResult] = useState<GeminiTestResult | null>(null);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [isRefreshingWorkbook, setIsRefreshingWorkbook] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setIsLoading(true);
    setError(null);

    try {
      setSettings(await fetchApi<SettingsStatus>("/api/settings/status"));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to load settings");
    } finally {
      setIsLoading(false);
    }
  }

  async function testGemini() {
    setIsTestingGemini(true);
    setGeminiResult(null);

    try {
      const response = await fetch("/api/test-gemini", { cache: "no-store" });
      setGeminiResult((await response.json()) as GeminiTestResult);
    } catch (error) {
      setGeminiResult({
        success: false,
        error: error instanceof Error ? error.message : "Unable to test Gemini",
      });
    } finally {
      setIsTestingGemini(false);
    }
  }

  async function refreshWorkbookCache() {
    setIsRefreshingWorkbook(true);
    setCacheMessage(null);

    try {
      const response = await fetch("/api/sheets/cache", {
        method: "POST",
        cache: "no-store",
      });
      const payload = (await response.json()) as ApiResult<{ cleared: boolean; clearedAt: string }>;

      if (!payload.ok) {
        throw new Error(payload.error);
      }

      setCacheMessage(`Workbook cache cleared at ${new Date(payload.data.clearedAt).toLocaleTimeString()}.`);
      await loadSettings();
    } catch (error) {
      setCacheMessage(error instanceof Error ? error.message : "Unable to refresh workbook cache");
    } finally {
      setIsRefreshingWorkbook(false);
    }
  }

  const healthCards = useMemo(() => {
    if (!settings) return [];

    return [
      {
        title: "Google Workbook",
        icon: Database,
        status: settings.health.googleWorkbook.status,
        message: settings.health.googleWorkbook.message,
      },
      {
        title: "Gemini AI",
        icon: Bot,
        status: settings.health.gemini.status,
        message: `${settings.health.gemini.message} Model: ${settings.health.gemini.model}.`,
      },
      {
        title: "HEFAMAA Portal",
        icon: Globe2,
        status: settings.health.portal.status,
        message: settings.health.portal.message,
      },
      {
        title: "Audit Database",
        icon: ShieldCheck,
        status: settings.health.auditDatabase.status,
        message: settings.health.auditDatabase.message,
      },
    ];
  }, [settings]);

  return (
    <AppShell>
      <section className="space-y-5 px-4 py-6 xl:px-6 2xl:px-7">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-[28px] font-extrabold tracking-[-0.03em] text-slate-950">
              Settings
            </h1>
            <p className="mt-1 text-[14px] text-slate-600">
              Runtime configuration, connection checks, and agent safety rules
            </p>
          </div>
          <button
            className="flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-[13px] font-bold text-slate-700 shadow-sm disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={isLoading}
            onClick={() => void loadSettings()}
            type="button"
          >
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Refresh
          </button>
        </div>

        {error ? (
          <p className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] font-semibold text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </p>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-4">
          {healthCards.map(({ icon: Icon, ...card }) => (
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm" key={card.title}>
              <div className="mb-4 flex items-start justify-between gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                  <Icon className="h-5 w-5" />
                </span>
                <StatusBadge status={card.status} />
              </div>
              <h2 className="text-[13px] font-extrabold text-slate-950">{card.title}</h2>
              <p className="mt-2 text-[12px] leading-5 text-slate-600">{card.message}</p>
            </article>
          ))}
          {!healthCards.length ? (
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading settings...
              </div>
            </article>
          ) : null}
        </div>

        <div className="grid gap-5 2xl:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-2">
              <FileKey2 className="h-5 w-5 text-blue-600" />
              <h2 className="text-[17px] font-bold text-slate-950">Environment Configuration</h2>
            </div>

            <div className="overflow-hidden rounded-lg border border-slate-200">
              <div className="grid gap-3 bg-slate-50 p-4 text-[11px] font-extrabold uppercase tracking-[0.03em] text-slate-500 xl:grid-cols-[230px_1fr_120px]">
                <span>Setting</span>
                <span>Safe Value</span>
                <span>Status</span>
              </div>
              {(settings?.items ?? []).map((item) => (
                <div
                  className="grid gap-3 border-t border-slate-200 p-4 xl:grid-cols-[230px_1fr_120px]"
                  key={item.envName}
                >
                  <div>
                    <p className="text-[13px] font-bold text-slate-950">{item.label}</p>
                    <p className="mt-1 font-mono text-[11px] font-semibold text-slate-500">{item.envName}</p>
                  </div>
                  <div>
                    <p className="break-words font-mono text-[12px] font-semibold text-slate-700">{item.value}</p>
                    <p className="mt-1 text-[11px] leading-4 text-slate-500">{item.note}</p>
                  </div>
                  <StatusBadge status={item.status} />
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-5">
            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-blue-700" />
                <h2 className="text-[17px] font-bold text-slate-950">Workbook Cache</h2>
              </div>
              <p className="text-[13px] leading-6 text-slate-600">
                Clears the short server-side workbook cache after direct edits in Google Drive.
              </p>
              <button
                className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 text-[13px] font-bold text-blue-800 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                disabled={isRefreshingWorkbook}
                onClick={() => void refreshWorkbookCache()}
                type="button"
              >
                {isRefreshingWorkbook ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {isRefreshingWorkbook ? "Refreshing..." : "Refresh Workbook Data"}
              </button>
              {cacheMessage ? (
                <p className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] font-semibold text-slate-700">
                  {cacheMessage}
                </p>
              ) : null}
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <Bot className="h-5 w-5 text-blue-700" />
                <h2 className="text-[17px] font-bold text-slate-950">AI Connection Test</h2>
              </div>
              <p className="text-[13px] leading-6 text-slate-600">
                Sends a small server-side request to Gemini and returns only the connection status.
              </p>
              <button
                className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-[13px] font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                disabled={isTestingGemini}
                onClick={() => void testGemini()}
                type="button"
              >
                {isTestingGemini ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                {isTestingGemini ? "Testing..." : "Test Gemini"}
              </button>

              {geminiResult ? (
                <div
                  className={`mt-4 rounded-lg border px-4 py-3 ${
                    geminiResult.success
                      ? "border-blue-200 bg-blue-50 text-blue-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  }`}
                >
                  <p className="text-[13px] font-bold">
                    {geminiResult.success ? "Gemini API is working" : "Gemini API test failed"}
                  </p>
                  <p className="mt-1 text-[12px] font-semibold">
                    {geminiResult.error || `HTTP status ${geminiResult.status ?? "unknown"}`}
                  </p>
                </div>
              ) : null}
            </article>

            <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center gap-2">
                <SlidersHorizontal className="h-5 w-5 text-amber-600" />
                <h2 className="text-[17px] font-bold text-slate-950">Agent Rules</h2>
              </div>
              <div className="space-y-3">
                {(settings?.rules ?? []).map((rule) => (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-4" key={rule.label}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-[13px] font-bold text-slate-950">{rule.label}</p>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-600 ring-1 ring-slate-200">
                        {rule.value}
                      </span>
                    </div>
                    <p className="mt-2 text-[12px] leading-5 text-slate-600">{rule.note}</p>
                  </div>
                ))}
              </div>
            </article>
          </section>
        </div>
      </section>
    </AppShell>
  );
}
