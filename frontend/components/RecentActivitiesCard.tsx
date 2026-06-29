"use client";

import { safeJsonResponse } from "@/lib/safeJson";
import { useEffect, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string };

type AuditEntry = {
  id?: number;
  timestamp: string;
  user: string;
  actionType: string;
  category?: string;
  facilityName?: string;
  status: "success" | "warning" | "failed";
  details?: string;
};

async function fetchApi<T>(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await safeJsonResponse<ApiResult<T>>(response, "components/RecentActivitiesCard.tsx"));

  if (!payload.ok) {
    throw new Error(payload.error);
  }

  return payload.data;
}

function timeAgo(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "recently";

  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + " min" + (minutes === 1 ? "" : "s") + " ago";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + " hour" + (hours === 1 ? "" : "s") + " ago";
  const days = Math.floor(hours / 24);
  return days + " day" + (days === 1 ? "" : "s") + " ago";
}

function titleFor(entry: AuditEntry) {
  return entry.facilityName || entry.category || entry.actionType.replace(/_/g, " ");
}

function descriptionFor(entry: AuditEntry) {
  const action = entry.actionType.replace(/_/g, " ");
  return entry.category ? action + " in " + entry.category : action;
}

export function RecentActivitiesCard() {
  const [activities, setActivities] = useState<AuditEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    fetchApi<AuditEntry[]>("/api/audit/list?limit=3")
      .then((data) => {
        if (mounted) setActivities(data);
      })
      .catch((error) => {
        if (mounted) setError(error instanceof Error ? error.message : "Unable to load recent activity");
      });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-bold text-slate-950">Recent Activities</h2>
        <a className="flex items-center gap-1.5 text-[12px] font-bold text-blue-700" href="/audit-log">
          View All
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>

      <div className="space-y-4">
        {activities.map((activity) => (
          <div className="grid grid-cols-[34px_1fr_auto] items-center gap-3" key={activity.id ?? activity.timestamp}>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <FileText className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-extrabold text-slate-950">{titleFor(activity)}</p>
              <p className="truncate text-[11px] font-medium text-slate-500">{descriptionFor(activity)}</p>
            </div>
            <span className="whitespace-nowrap text-[11px] text-slate-500">{timeAgo(activity.timestamp)}</span>
          </div>
        ))}
        {!activities.length ? (
          <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-[12px] font-semibold text-slate-500">
            {error ?? "No audit activity has been recorded yet."}
          </p>
        ) : null}
      </div>
    </section>
  );
}
