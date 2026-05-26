import type { ReactNode } from "react";

import { Sidebar } from "@/components/Sidebar";
import { TopHeader } from "@/components/TopHeader";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f6f8fb]">
      <Sidebar />
      <TopHeader />
      <main className="lg:ml-[260px]">{children}</main>
    </div>
  );
}
