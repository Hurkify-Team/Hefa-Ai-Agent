import { ChevronDown, FileSpreadsheet, UserRound } from "lucide-react";

export function TopHeader() {
  return (
    <header className="sticky top-0 z-30 ml-0 flex h-[82px] items-center justify-end border-b border-slate-200/70 bg-[#061826] px-4 shadow-sm lg:ml-[260px] lg:px-8">
      <div className="flex w-full items-center justify-between gap-4 lg:justify-end">
        <div className="flex items-center gap-3 lg:hidden">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-sm font-black text-emerald-700">
            HF
          </div>
          <div>
            <p className="text-sm font-bold text-white">HEFAMAA AI Agent</p>
            <p className="text-xs text-slate-300">Smart Facility Registry Assistant</p>
          </div>
        </div>

        <div className="hidden items-center gap-5 sm:flex">
          <button
            aria-label="Connected Google Sheet"
            className="flex h-[52px] min-w-[280px] items-center gap-3 rounded-lg border border-white/10 bg-white px-4 text-left shadow-sm"
            type="button"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <FileSpreadsheet className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] text-slate-500">
                Connected to Google Sheet
              </span>
              <span className="block truncate text-[13px] font-semibold text-slate-900">
                HEFAMAA_Database.xlsx
              </span>
            </span>
            <ChevronDown className="h-4 w-4 text-slate-500" />
          </button>

          <button
            aria-label="Admin User profile menu"
            className="flex h-[52px] items-center gap-3 text-left"
            type="button"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-white/20 bg-slate-100 text-slate-700">
              <UserRound className="h-6 w-6" />
            </span>
            <span className="hidden min-w-[110px] xl:block">
              <span className="block text-[14px] font-semibold text-white">Admin User</span>
              <span className="block text-[12px] text-slate-300">Administrator</span>
            </span>
            <ChevronDown className="h-4 w-4 text-slate-300" />
          </button>
        </div>
      </div>
    </header>
  );
}
