"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  LucideIcon,
} from "lucide-react";
import { sidebarSections } from "@/lib/mockData";

type MenuItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

function SidebarItem({ item }: { item: MenuItem }) {
  const Icon = item.icon;
  const pathname = usePathname();
  const active = pathname === item.href;

  return (
    <Link
      className={[
        "group flex h-10 w-full items-center gap-3 rounded-lg px-3 text-left text-[13px] font-medium transition",
        active
          ? "bg-emerald-600 text-white shadow-[0_12px_28px_rgba(16,185,129,0.24)]"
          : "text-slate-200 hover:bg-white/10 hover:text-white",
      ].join(" ")}
      href={item.href}
    >
      <Icon
        className={[
          "h-[17px] w-[17px]",
          active ? "text-emerald-100" : "text-slate-400 group-hover:text-emerald-200",
        ].join(" ")}
      />
      <span>{item.label}</span>
    </Link>
  );
}

function StatusRow({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/10 py-3 last:border-b-0">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-emerald-300 ring-1 ring-white/10">
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] leading-4 text-slate-300">{label}</p>
        <p className="truncate text-[12px] font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] overflow-y-auto bg-[radial-gradient(circle_at_70%_90%,rgba(16,185,129,0.33),transparent_18rem),linear-gradient(180deg,#071829_0%,#071522_45%,#04352d_100%)] text-white shadow-2xl lg:block">
      <div className="flex min-h-full flex-col border-r border-white/10">
        <div className="flex h-[82px] items-center gap-3 border-b border-white/10 px-6">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white p-1 shadow-lg">
            <div className="flex h-full w-full items-center justify-center rounded-full border border-emerald-100 bg-emerald-50">
              <span className="text-[15px] font-black text-emerald-700">HF</span>
            </div>
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-[17px] font-bold tracking-[-0.01em]">
              HEFAMAA AI Agent
            </h1>
            <p className="truncate text-[12px] text-slate-300">
              Smart Facility Registry Assistant
            </p>
          </div>
        </div>

        <nav className="flex-1 space-y-7 px-4 py-8">
          {sidebarSections.map((section) => (
            <div key={section.label}>
              <p className="mb-3 px-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-slate-400">
                {section.label}
              </p>
              <div className="space-y-1.5">
                {section.items.map((item) => (
                  <SidebarItem item={item} key={item.label} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-4 pb-5">
          <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-2 shadow-[0_16px_50px_rgba(4,120,87,0.22)]">
            <StatusRow icon={Bot} label="AI Agent Status" value="Online" />
            <StatusRow icon={FileSpreadsheet} label="Portal Connection" value="Active" />
            <StatusRow icon={Clock3} label="Last Sync" value="2 mins ago" />
          </div>
          <div className="mt-8 flex items-center gap-1 px-2 text-[11px] text-slate-300">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
            v1.0.0
          </div>
        </div>
      </div>
    </aside>
  );
}
