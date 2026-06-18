import type { ReactNode } from "react";

import { AuthGate } from "@/components/AuthProvider";
import { Sidebar } from "@/components/Sidebar";
import { TopHeader } from "@/components/TopHeader";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <AuthGate>
      <div className="min-h-screen bg-[#f6f8fb] transition-colors">
        <Sidebar />
        <TopHeader />
        <main className="lg:ml-[260px]">{children}</main>
      </div>
    </AuthGate>
  );
}
