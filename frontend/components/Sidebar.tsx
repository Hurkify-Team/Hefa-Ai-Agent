"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Bot,
  CheckCircle2,
  Clock3,
  FileSpreadsheet,
  LucideIcon,
  Moon,
  Search,
  Sparkles,
  Sun,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { sidebarSections } from "@/lib/mockData";

type MenuItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

type ThemeMode = "light" | "dark";

function applyTheme(theme: ThemeMode) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.theme = theme;
}

function SidebarItem({ item }: { item: MenuItem }) {
  const Icon = item.icon;
  const pathname = usePathname();
  const active = pathname === item.href;

  return (
    <Link
      className={[
        "group flex h-10 w-full items-center gap-3 rounded-xl px-2.5 text-left text-[13px] font-bold transition",
        active ? "bg-blue-600 text-white shadow-[0_12px_28px_rgba(37,99,235,0.22)]" : "text-slate-600 hover:bg-blue-50 hover:text-blue-700",
      ].join(" ")}
      href={item.href}
    >
      <span className={["flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition", active ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-blue-700"].join(" ")}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

function StatusRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-slate-200 py-3 last:border-b-0">
      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-700 ring-1 ring-blue-100"><Icon className="h-4 w-4" /></span>
      <div className="min-w-0"><p className="text-[11px] leading-4 text-slate-500">{label}</p><p className="truncate text-[12px] font-extrabold text-slate-900">{value}</p></div>
    </div>
  );
}

export function Sidebar() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [searchQuery, setSearchQuery] = useState("");
  const { canAccessPath, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("hefamaa-theme");
    const nextTheme: ThemeMode = savedTheme === "dark" ? "dark" : "light";
    setTheme(nextTheme);
    applyTheme(nextTheme);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("hefamaa-sidebar-search")?.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const visibleSections = useMemo(
    () => sidebarSections
      .map((section) => ({ ...section, items: section.items.filter((item) => canAccessPath(item.href)) }))
      .filter((section) => section.items.length > 0),
    [canAccessPath],
  );

  const searchableItems = useMemo(
    () => visibleSections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.label }))),
    [visibleSections],
  );
  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return searchableItems.filter((item) => (item.label + " " + item.section).toLowerCase().includes(query)).slice(0, 7);
  }, [searchQuery, searchableItems]);

  function updateTheme(nextTheme: ThemeMode) {
    setTheme(nextTheme);
    applyTheme(nextTheme);
    window.localStorage.setItem("hefamaa-theme", nextTheme);
    window.dispatchEvent(new CustomEvent("hefamaa-theme-change", { detail: nextTheme }));
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    const exact = filteredItems[0];
    if (exact) {
      router.push(exact.href);
      setSearchQuery("");
      return;
    }
    router.push("/facility-search?query=" + encodeURIComponent(query));
  }

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[260px] overflow-y-auto border-r border-slate-200 bg-white text-slate-900 shadow-[10px_0_40px_rgba(15,23,42,0.04)] lg:block">
      <div className="flex min-h-full flex-col">
        <div className="flex h-[82px] items-center gap-3 border-b border-slate-200 px-5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-[0_14px_30px_rgba(37,99,235,0.22)]"><Sparkles className="h-5 w-5" /></div>
          <div className="min-w-0"><h1 className="truncate text-[16px] font-black tracking-[-0.01em] text-slate-950">HEFAMAA Agent</h1><p className="truncate text-[12px] font-semibold text-slate-500">Smart Registry Assistant</p></div>
        </div>

        <div className="px-4 pt-4">
          <form className="relative" onSubmit={submitSearch}>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-10 text-[12px] font-semibold text-slate-700 outline-none placeholder:text-slate-400 focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-50"
              id="hefamaa-sidebar-search"
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search pages or facilities"
              value={searchQuery}
            />
            <span className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-slate-400">Ctrl K</span>
            {searchQuery.trim() ? (
              <div className="absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.14)]">
                {filteredItems.length ? filteredItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link className="flex items-center gap-3 border-b border-slate-100 px-3 py-2.5 text-[12px] font-bold text-slate-700 last:border-b-0 hover:bg-blue-50 hover:text-blue-700" href={item.href} key={item.href} onClick={() => setSearchQuery("")}>
                      <Icon className="h-4 w-4 text-blue-600" />
                      <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span><span className="block text-[10px] font-semibold uppercase tracking-[0.04em] text-slate-400">{item.section}</span></span>
                    </Link>
                  );
                }) : <button className="flex w-full items-center gap-3 px-3 py-3 text-left text-[12px] font-bold text-blue-700 hover:bg-blue-50" type="submit"><Search className="h-4 w-4" />Search facilities for “{searchQuery.trim()}”</button>}
              </div>
            ) : null}
          </form>
        </div>

        <nav className="flex-1 space-y-6 px-4 py-5">
          {visibleSections.map((section) => (
            <div key={section.label}>
              <p className="mb-2 px-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-400">{section.label}</p>
              <div className="space-y-1">{section.items.map((item) => <SidebarItem item={item} key={item.label} />)}</div>
            </div>
          ))}
        </nav>

        <div className="px-4 pb-5">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2"><StatusRow icon={Bot} label="AI Assistance Status" value="Online" /><StatusRow icon={FileSpreadsheet} label="Workspace Role" value={user?.role ?? "Signed in"} /><StatusRow icon={Clock3} label="Last Sync" value="2 mins ago" /></div>
          <div className="mt-4 grid grid-cols-2 rounded-xl border border-slate-200 bg-white p-1 text-[12px] font-bold text-slate-500">
            <button aria-pressed={theme === "light"} className={["flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 transition", theme === "light" ? "bg-blue-600 text-white" : "hover:bg-blue-50 hover:text-blue-700"].join(" ")} onClick={() => updateTheme("light")} type="button"><Sun className="h-3.5 w-3.5" />Light</button>
            <button aria-pressed={theme === "dark"} className={["flex h-9 items-center justify-center gap-1.5 rounded-lg px-2 transition", theme === "dark" ? "bg-blue-600 text-white" : "hover:bg-blue-50 hover:text-blue-700"].join(" ")} onClick={() => updateTheme("dark")} type="button"><Moon className="h-3.5 w-3.5" />Dark</button>
          </div>
          <div className="mt-5 flex items-center gap-1 px-2 text-[11px] font-semibold text-slate-500"><CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />v1.0.0</div>
        </div>
      </div>
    </aside>
  );
}
