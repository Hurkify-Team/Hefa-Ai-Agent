"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Bell,
  ChevronDown,
  FileSpreadsheet,
  Gift,
  HelpCircle,
  PanelRight,
  Settings,
  UserRound,
  UsersRound,
} from "lucide-react";

import { useAuth } from "@/components/AuthProvider";

type HeaderMenu = "sheet" | "help" | "updates" | "notifications" | "panel" | "profile" | null;

type IconButton = {
  label: string;
  menu: Exclude<HeaderMenu, "sheet" | "profile" | null>;
  icon: typeof Bell;
};

const headerIconButtons: IconButton[] = [
  { label: "Help", menu: "help", icon: HelpCircle },
  { label: "Updates", menu: "updates", icon: Gift },
  { label: "Notifications", menu: "notifications", icon: Bell },
  { label: "Panel", menu: "panel", icon: PanelRight },
];

const notifications = [
  { title: "Portal scan ready", detail: "Latest portal cache is available for AI Assistance.", time: "Just now" },
  { title: "Workbook connected", detail: "Active and old database lookup is configured.", time: "5 mins ago" },
  { title: "Full detail scan", detail: "Resume is enabled if the portal scan stops midway.", time: "Today" },
];

function MenuCard({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div
      className={[
        "absolute right-0 top-12 z-50 rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-[0_24px_80px_rgba(15,23,42,0.16)]",
        wide ? "w-[340px]" : "w-[260px]",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

function toggleMenu(current: HeaderMenu, next: HeaderMenu) {
  return current === next ? null : next;
}

export function TopHeader() {
  const [activeMenu, setActiveMenu] = useState<HeaderMenu>(null);
  const { signOut, user } = useAuth();

  return (
    <header className="sticky top-0 z-30 ml-0 flex h-[82px] items-center border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur lg:ml-[260px] lg:px-6">
      <div className="flex w-full items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-sm font-black text-white lg:hidden">
            HF
          </div>
          <div>
            <p className="text-[15px] font-black text-slate-950">HEFAMAA Smart Registry</p>
            <p className="text-[12px] font-semibold text-slate-500">Blue workspace mode</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="relative hidden sm:block">
            <button
              aria-expanded={activeMenu === "sheet"}
              aria-label="Connected Google Sheet"
              className="flex h-11 min-w-[250px] items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 text-left transition hover:border-blue-200 hover:bg-blue-50"
              onClick={() => setActiveMenu((current) => toggleMenu(current, "sheet"))}
              type="button"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white">
                <FileSpreadsheet className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[11px] font-bold text-slate-500">Connected to Google Sheet</span>
                <span className="block truncate text-[12px] font-black text-slate-900">HEFAMAA_Database.xlsx</span>
              </span>
              <ChevronDown className="h-4 w-4 text-slate-500" />
            </button>
            {activeMenu === "sheet" ? (
              <MenuCard wide>
                <p className="text-[12px] font-black uppercase tracking-[0.05em] text-slate-400">Workbook</p>
                <p className="mt-2 text-[14px] font-black text-slate-950">HEFAMAA Active Database</p>
                <p className="mt-1 text-[12px] font-semibold leading-5 text-slate-600">
                  Active workbook lookup is used first. Old Hefamaa Database is used only as fallback where the active database is missing data.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Link className="rounded-xl border border-slate-200 px-3 py-2 text-center text-[12px] font-black text-slate-700 hover:bg-blue-50" href="/settings">
                    System settings
                  </Link>
                  <Link className="rounded-xl bg-blue-600 px-3 py-2 text-center text-[12px] font-black text-white hover:bg-blue-700" href="/facility-search">
                    Search sheet
                  </Link>
                </div>
              </MenuCard>
            ) : null}
          </div>

          {headerIconButtons.map(({ label, icon: Icon, menu }) => (
            <div className="relative" key={label}>
              <button
                aria-expanded={activeMenu === menu}
                aria-label={label}
                className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                onClick={() => setActiveMenu((current) => toggleMenu(current, menu))}
                type="button"
              >
                <Icon className="h-4 w-4" />
              </button>

              {activeMenu === "notifications" && menu === "notifications" ? (
                <MenuCard wide>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-[14px] font-black text-slate-950">Notifications</p>
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-black text-blue-700">3 new</span>
                  </div>
                  <div className="mt-3 space-y-2">
                    {notifications.map((item) => (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" key={item.title}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[12px] font-black text-slate-900">{item.title}</p>
                          <span className="shrink-0 text-[10px] font-bold text-slate-400">{item.time}</span>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold leading-5 text-slate-600">{item.detail}</p>
                      </div>
                    ))}
                  </div>
                  <Link className="mt-3 flex h-9 items-center justify-center rounded-xl bg-blue-600 text-[12px] font-black text-white hover:bg-blue-700" href="/notifications">
                    Open notification centre
                  </Link>
                </MenuCard>
              ) : null}

              {activeMenu === menu && menu === "help" ? (
                <MenuCard>
                  <p className="text-[14px] font-black text-slate-950">Help</p>
                  <p className="mt-2 text-[12px] font-semibold leading-5 text-slate-600">
                    Use AI Assistance for facility questions, HEF/NO lookup, exports, and portal status summaries.
                  </p>
                  <Link className="mt-3 flex h-9 items-center justify-center rounded-xl border border-slate-200 text-[12px] font-black text-slate-700 hover:bg-blue-50" href="/ai-chat">
                    Open AI Assistance
                  </Link>
                </MenuCard>
              ) : null}

              {activeMenu === menu && menu === "updates" ? (
                <MenuCard>
                  <p className="text-[14px] font-black text-slate-950">Updates</p>
                  <div className="mt-3 space-y-2 text-[12px] font-semibold leading-5 text-slate-600">
                    <p>Latest-year portal capture is enabled for current renewal records.</p>
                    <p>AI answers now use faster source routing with workbook fallback for HEF/NO.</p>
                  </div>
                </MenuCard>
              ) : null}

              {activeMenu === menu && menu === "panel" ? (
                <MenuCard>
                  <p className="text-[14px] font-black text-slate-950">Workspace Panel</p>
                  <div className="mt-3 grid gap-2">
                    <Link className="rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-black text-slate-700 hover:bg-blue-50" href="/portal-scan">
                      Portal scan monitor
                    </Link>
                    <Link className="rounded-xl border border-slate-200 px-3 py-2 text-[12px] font-black text-slate-700 hover:bg-blue-50" href="/reports">
                      Reports dashboard
                    </Link>
                  </div>
                </MenuCard>
              ) : null}
            </div>
          ))}

          <div className="relative">
            <button
              aria-expanded={activeMenu === "profile"}
              aria-label="User profile menu"
              className="flex h-11 items-center gap-3 rounded-xl border border-slate-200 bg-white px-2 text-left transition hover:border-blue-200 hover:bg-blue-50 sm:px-3"
              onClick={() => setActiveMenu((current) => toggleMenu(current, "profile"))}
              type="button"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-700">
                <UserRound className="h-4 w-4" />
              </span>
              <span className="hidden min-w-[110px] xl:block">
                <span className="block text-[13px] font-black text-slate-950">{user?.name ?? "Admin User"}</span>
                <span className="block text-[11px] font-semibold text-slate-500">{user?.role ?? "Administrator"}</span>
              </span>
              <ChevronDown className="hidden h-4 w-4 text-slate-400 sm:block" />
            </button>

            {activeMenu === "profile" ? (
              <MenuCard>
                <div className="flex items-center gap-3 border-b border-slate-200 pb-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-600 text-white">
                    <UserRound className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-[13px] font-black text-slate-950">{user?.name ?? "Admin User"}</p>
                    <p className="text-[11px] font-semibold text-slate-500">{user?.role ?? "Administrator"} workspace</p>
                  </div>
                </div>
                <div className="mt-3 grid gap-2">
                  <Link className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-black text-slate-700 hover:bg-blue-50" href="/users-roles">
                    <UsersRound className="h-4 w-4 text-blue-600" />
                    Users and roles
                  </Link>
                  <Link className="flex items-center gap-2 rounded-xl px-3 py-2 text-[12px] font-black text-slate-700 hover:bg-blue-50" href="/settings">
                    <Settings className="h-4 w-4 text-blue-600" />
                    System settings
                  </Link>
                </div>
                <button className="mt-3 h-9 w-full rounded-xl border border-slate-200 text-[12px] font-black text-slate-500 hover:bg-slate-50" onClick={() => void signOut()} type="button">
                  Sign out
                </button>
              </MenuCard>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
