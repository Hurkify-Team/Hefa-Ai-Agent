"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { FormEvent, useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Database,
  Download,
  FileSpreadsheet,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  ShieldCheck,
  Table2,
  UserRound,
} from "lucide-react";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type AgentSource = "portal" | "sheets";

type AgentSourceResult = {
  answer?: string;
  error?: string;
  label: string;
  record?: Record<string, unknown>;
  rows?: Array<Record<string, unknown>>;
  source: AgentSource;
  status: "ok" | "error";
};

type AgentAction = {
  description: string;
  href: string;
  label: string;
  source: AgentSource;
};

type AgentAnswer = {
  actions: AgentAction[];
  answer: string;
  question: string;
  sources: AgentSourceResult[];
};

type ChatMessage = {
  actions?: AgentAction[];
  content: string;
  id: string;
  role: "assistant" | "user";
  sources?: AgentSourceResult[];
};

const quickPrompts = [
  "How many facilities do we have on the portal?",
  "What is the status for Victoria Abayomi Maternity?",
  "Which category has the highest number of facilities?",
  "How many new registrations do we have?",
  "Show facilities in Ikeja with missing contact",
  "Export all 2026 Maternity Home records",
];

const initialMessages: ChatMessage[] = [
  {
    id: "welcome",
    role: "assistant",
    content:
      "I am HEFA-AI, your HEFAMAA registry assistant. Ask me any facility, portal, spreadsheet, status, export, or cleanup question and I will show the source used for the answer.",
  },
];

async function fetchApi<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, { cache: "no-store", ...init });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "components/AIAgentChat.tsx"));

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function rowTitle(row: Record<string, unknown>) {
  const candidates = [
    row["Facility Name"],
    row["FACILITY NAME"],
    row.facilityName,
    row.Name,
    row["HEF/NO"],
    row.hefamaaId,
  ];
  const found = candidates.find((value) => value !== null && value !== undefined && String(value).trim());
  return found ? String(found) : "Facility record";
}

function rowColumns(row: Record<string, unknown>) {
  const preferred = [
    "Category",
    "HEF/NO",
    "Facility Name",
    "facilityName",
    "hefamaaId",
    "category",
    "registrationStatus",
    "renewalYear",
    "LGA",
    "Address",
    "Contact",
  ];
  const keys = preferred.filter((key) => key in row);
  const fallback = Object.keys(row).filter((key) => !keys.includes(key));
  return [...keys, ...fallback].slice(0, 5);
}

function MessageText({ content }: { content: string }) {
  const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);

  return (
    <div className="space-y-2 text-[14px] font-medium leading-7 text-slate-800">
      {lines.map((line, index) => {
        const bullet = line.startsWith("- ");
        return (
          <p className={bullet ? "pl-4" : ""} key={index}>
            {bullet ? <span className="mr-2 text-blue-600">-</span> : null}
            {bullet ? line.slice(2) : line}
          </p>
        );
      })}
    </div>
  );
}

function SourceBadge({ source }: { source: AgentSourceResult }) {
  const Icon = source.source === "portal" ? Database : FileSpreadsheet;
  const ok = source.status === "ok";

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-extrabold",
        ok ? "bg-blue-50 text-blue-700 ring-1 ring-blue-100" : "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
      ].join(" ")}
    >
      <Icon className="h-3.5 w-3.5" />
      {source.label}
    </span>
  );
}

function SourceEvidence({ source }: { source: AgentSourceResult }) {
  const rows = source.rows?.slice(0, 4) ?? [];
  const recordEntries = source.record
    ? Object.entries(source.record).filter(([, value]) => value !== undefined && value !== null && typeof value !== "object")
    : [];

  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SourceBadge source={source} />
        {source.status === "ok" ? (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-blue-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Source checked
          </span>
        ) : (
          <span className="text-[11px] font-bold text-rose-700">Source unavailable</span>
        )}
      </div>

      {source.status === "error" ? (
        <p className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
          {source.error}
        </p>
      ) : (
        <p className="text-[12px] font-semibold leading-5 text-slate-600">{source.answer}</p>
      )}

      {recordEntries.length ? (
        <dl className="mt-3 grid gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">
          {recordEntries.slice(0, 8).map(([key, value]) => (
            <div key={key}>
              <dt className="text-[10px] font-extrabold uppercase tracking-[0.05em] text-slate-500">
                {key.replace(/([A-Z])/g, " $1")}
              </dt>
              <dd className="mt-1 break-words text-[12px] font-bold text-slate-900">{displayValue(value)}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {rows.length ? (
        <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
          <div className="bg-slate-50 px-3 py-2 text-[11px] font-extrabold uppercase tracking-[0.06em] text-slate-500">
            Evidence rows
          </div>
          <div className="divide-y divide-slate-100">
            {rows.map((row, rowIndex) => {
              const columns = rowColumns(row);
              return (
                <div className="p-3" key={rowIndex}>
                  <p className="truncate text-[12px] font-extrabold text-slate-950">{rowTitle(row)}</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {columns.map((column) => (
                      <div className="min-w-0" key={column}>
                        <p className="truncate text-[10px] font-extrabold uppercase tracking-[0.05em] text-slate-400">
                          {column}
                        </p>
                        <p className="mt-0.5 truncate text-[12px] font-semibold text-slate-700">
                          {displayValue(row[column])}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ActionLinks({ actions }: { actions?: AgentAction[] }) {
  if (!actions?.length) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {actions.map((action) => (
        <a
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 text-[12px] font-extrabold text-blue-700 transition hover:bg-blue-100"
          href={action.href}
          key={action.href}
        >
          <Download className="h-4 w-4" />
          {action.label}
        </a>
      ))}
    </div>
  );
}

function TypingIndicator() {
  return (
    <span className="flex items-center gap-1" aria-label="HEFA-AI is thinking">
      {[0, 1, 2].map((index) => (
        <span
          className="h-2 w-2 rounded-full bg-blue-600 animate-[hefamaaTyping_1s_ease-in-out_infinite]"
          key={index}
          style={{ animationDelay: index * 120 + "ms" }}
        />
      ))}
    </span>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  const Icon = isUser ? UserRound : Bot;

  return (
    <div className={["flex gap-3 animate-[hefamaaMessageIn_220ms_ease-out_both]", isUser ? "justify-end" : "justify-start"].join(" ")}>
      {!isUser ? (
        <span className="relative mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.28)] animate-[hefamaaPulseGlow_2.8s_ease-in-out_infinite]">
          <span className="absolute inset-0 rounded-full bg-blue-400/20" />
          <Icon className="relative h-[18px] w-[18px]" />
        </span>
      ) : null}
      <div className={["max-w-[920px]", isUser ? "order-first" : ""].join(" ")}>
        <div
          className={[
            "rounded-[22px] px-4 py-3",
            isUser
              ? "bg-blue-700 text-white shadow-[0_16px_28px_rgba(37,99,235,0.2)]"
              : "border border-slate-200 bg-white text-slate-900 shadow-sm",
          ].join(" ")}
        >
          {isUser ? (
            <p className="text-[13px] font-semibold leading-6">{message.content}</p>
          ) : (
            <MessageText content={message.content} />
          )}
          {!isUser ? <ActionLinks actions={message.actions} /> : null}
        </div>

        {!isUser && message.sources?.length ? (
          <div className="mt-3 grid gap-3">
            {message.sources.map((source) => (
              <SourceEvidence key={source.source} source={source} />
            ))}
          </div>
        ) : null}
      </div>
      {isUser ? (
        <span className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      ) : null}
    </div>
  );
}

export function AIAgentChat() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [question, setQuestion] = useState("");
  const [sources, setSources] = useState<AgentSource[]>(["portal", "sheets"]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, isSending]);

  function toggleSource(source: AgentSource) {
    setSources((current) => {
      if (current.includes(source)) {
        return current.length === 1 ? current : current.filter((item) => item !== source);
      }
      return [...current, source];
    });
  }

  async function submitQuestion(event?: FormEvent<HTMLFormElement>, prompt?: string) {
    event?.preventDefault();
    const nextQuestion = (prompt ?? question).trim();
    if (!nextQuestion || isSending) return;

    const userMessage: ChatMessage = {
      id: "user-" + Date.now(),
      role: "user",
      content: nextQuestion,
    };

    setMessages((current) => [...current, userMessage]);
    setQuestion("");
    setError(null);
    setIsSending(true);

    try {
      const answer = await fetchApi<AgentAnswer>("/api/ai/ask-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nextQuestion, sources }),
      });

      setMessages((current) => [
        ...current,
        {
          id: "assistant-" + Date.now(),
          role: "assistant",
          content: answer.answer,
          sources: answer.sources,
          actions: answer.actions,
        },
      ]);
    } catch (fetchError) {
      const message = fetchError instanceof Error ? fetchError.message : "Unable to ask the agent.";
      setError(message);
      setMessages((current) => [
        ...current,
        {
          id: "assistant-error-" + Date.now(),
          role: "assistant",
          content: "I could not complete that question. " + message,
        },
      ]);
    } finally {
      setIsSending(false);
    }
  }

  return (
    <section className="min-h-[calc(100vh-82px)] bg-[#f6f9ff] px-4 py-5 xl:px-6 2xl:px-7">
      <div className="mx-auto grid max-w-7xl gap-5 xl:grid-cols-[minmax(0,1fr)_310px]">
        <div className="flex min-h-[calc(100vh-122px)] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_22px_70px_rgba(15,23,42,0.07)]">
          <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 text-white shadow-[0_12px_24px_rgba(37,99,235,0.22)] animate-[hefamaaFloat_3s_ease-in-out_infinite]">
                <MessageSquareText className="h-[18px] w-[18px]" />
              </span>
              <div>
                <h1 className="text-[15px] font-black text-slate-950">HEFA-AI</h1>
                <p className="text-[11px] font-semibold text-slate-500">Portal and workbook reasoning</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                aria-label="Use portal scan source"
                className={[
                  "flex h-9 items-center gap-2 rounded-xl border px-3 text-[12px] font-black transition",
                  sources.includes("portal")
                    ? "border-blue-200 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:text-blue-700",
                ].join(" ")}
                onClick={() => toggleSource("portal")}
                type="button"
              >
                <Database className="h-4 w-4" />
                Portal
              </button>
              <button
                aria-label="Use active and old database source"
                className={[
                  "flex h-9 items-center gap-2 rounded-xl border px-3 text-[12px] font-black transition",
                  sources.includes("sheets")
                    ? "border-blue-200 bg-blue-600 text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-blue-50 hover:text-blue-700",
                ].join(" ")}
                onClick={() => toggleSource("sheets")}
                type="button"
              >
                <FileSpreadsheet className="h-4 w-4" />
                Sheets
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
            {messages.length <= 1 ? (
              <div className="mx-auto flex min-h-[430px] max-w-3xl flex-col items-center justify-center text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700 ring-1 ring-blue-100 animate-[hefamaaPulseGlow_3s_ease-in-out_infinite]">
                  <Bot className="h-7 w-7" />
                </span>
                <h2 className="mt-5 text-[34px] font-black tracking-[-0.04em] text-slate-950 sm:text-[42px]">
                  Welcome to HEFA-AI
                </h2>
                <p className="mt-3 max-w-2xl text-[14px] font-semibold leading-6 text-slate-500">
                  Ask HEFAMAA questions across live portal data, portal scan cache, the Active Database, and the Old Database fallback.
                </p>

                <div className="mt-8 grid w-full max-w-2xl gap-3 sm:grid-cols-2">
                  {quickPrompts.slice(0, 4).map((prompt, index) => {
                    const icons = [MessageSquareText, Database, FileSpreadsheet, ShieldCheck];
                    const Icon = icons[index] ?? MessageSquareText;
                    return (
                      <button
                        className="group flex h-14 items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:shadow-md disabled:opacity-60"
                        disabled={isSending}
                        key={prompt}
                        onClick={() => void submitQuestion(undefined, prompt)}
                        type="button"
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-100">
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="truncate text-[13px] font-black text-slate-800">{prompt}</span>
                        </span>
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition group-hover:border-blue-200 group-hover:text-blue-700">+</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="mx-auto max-w-4xl space-y-6">
                {messages.filter((message) => message.id !== "welcome").map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
                {isSending ? (
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-600 text-white">
                      <Bot className="h-[18px] w-[18px]" />
                    </span>
                    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-[13px] font-bold text-slate-600 shadow-sm">
                      <TypingIndicator />
                      HEFA-AI is checking connected sources...
                    </div>
                  </div>
                ) : null}
                <div ref={endRef} />
              </div>
            )}
          </div>

          <form className="border-t border-slate-200 bg-white p-4 sm:px-6" onSubmit={(event) => void submitQuestion(event)}>
            {error ? (
              <p className="mx-auto mb-3 max-w-4xl rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[12px] font-semibold text-rose-700">
                {error}
              </p>
            ) : null}
            <div className="mx-auto max-w-4xl rounded-2xl border border-slate-200 bg-white p-2 shadow-[0_18px_50px_rgba(15,23,42,0.08)] focus-within:border-blue-300 focus-within:ring-4 focus-within:ring-blue-50">
              <textarea
                className="min-h-[52px] w-full resize-none border-0 bg-transparent px-3 py-2 text-[14px] font-semibold text-slate-900 outline-none placeholder:text-slate-400"
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void submitQuestion();
                  }
                }}
                placeholder="Ask HEFA-AI about a facility, HEF/NO, status, LGA, duplicates, exports, or missing data..."
                value={question}
              />
              <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-2 pt-2">
                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                  <button className="rounded-lg border border-slate-200 px-2 py-1 transition hover:bg-blue-50 hover:text-blue-700" type="button">Attach</button>
                  <button className="rounded-lg border border-slate-200 px-2 py-1 transition hover:bg-blue-50 hover:text-blue-700" type="button">Browse prompts</button>
                </div>
                <button
                  aria-label="Send question"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white shadow-[0_12px_24px_rgba(37,99,235,0.24)] transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={isSending || !question.trim()}
                  type="submit"
                >
                  {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </form>
        </div>

        <aside className="space-y-4">
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-black text-slate-950">Projects</h2>
              <button aria-label="More projects" className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-blue-50" type="button">...</button>
            </div>
            <div className="mt-3 space-y-2">
              {["New facility lookup", "Renewal status review", "Mushin facility export", "Missing contact cleanup"].map((item) => (
                <button className="w-full rounded-2xl border border-slate-200 bg-white px-3 py-3 text-left transition hover:border-blue-200 hover:bg-blue-50" key={item} type="button">
                  <span className="block truncate text-[12px] font-black text-slate-800">{item}</span>
                  <span className="mt-1 block truncate text-[11px] font-semibold text-slate-500">HEFAMAA registry workspace</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
            <h2 className="flex items-center gap-2 text-[13px] font-black text-slate-950">
              <Table2 className="h-[17px] w-[17px] text-blue-600" />
              Connected Sources
            </h2>
            <div className="mt-3 space-y-2">
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-3">
                <p className="flex items-center gap-2 text-[12px] font-black text-blue-800">
                  <Database className="h-4 w-4" />
                  Portal Scan Cache
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-5 text-blue-900">
                  Uses latest/current portal records for workflow status, categories, and offline answers.
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <p className="flex items-center gap-2 text-[12px] font-black text-slate-800">
                  <FileSpreadsheet className="h-4 w-4" />
                  Active + Old Databases
                </p>
                <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-600">
                  HEF/NO answers always come from spreadsheet rows, with Facility Code as old-database fallback.
                </p>
              </div>
            </div>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
            <h2 className="flex items-center gap-2 text-[13px] font-black text-slate-950">
              <Search className="h-[17px] w-[17px] text-blue-600" />
              Quick Questions
            </h2>
            <div className="mt-3 space-y-2">
              {quickPrompts.slice(4).map((prompt) => (
                <button
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left text-[12px] font-bold leading-5 text-slate-700 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-800"
                  disabled={isSending}
                  key={prompt}
                  onClick={() => void submitQuestion(undefined, prompt)}
                  type="button"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </section>
  );
}
