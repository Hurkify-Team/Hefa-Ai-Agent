import { MailCheck } from "lucide-react";

import { AppShell } from "@/components/AppShell";
import { listNotificationTemplates } from "@/lib/notificationEngine";

export default function NotificationTemplatesPage() {
  const templates = listNotificationTemplates();
  return (
    <AppShell>
      <section className="min-h-screen bg-[#f6f9ff] px-4 py-6 xl:px-6">
        <div className="rounded-3xl border border-blue-100 bg-white p-5 shadow-[0_22px_60px_rgba(15,23,42,0.07)]"><p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-blue-700"><MailCheck className="h-4 w-4" /> Notification Templates</p><h1 className="mt-2 text-[28px] font-semibold tracking-[-0.03em] text-slate-950">Reusable Email & SMS Templates</h1><p className="mt-1 text-[14px] font-medium text-slate-600">Templates support variables like facility name, owner name, LGA, deadline, portal link, and missing requirements.</p></div>
        <div className="mt-5 grid gap-4 lg:grid-cols-2">{templates.map((template) => <article className="rounded-3xl border border-slate-200 bg-white p-5 shadow-[0_18px_45px_rgba(15,23,42,0.06)]" key={template.id}><div className="flex items-start justify-between gap-3"><div><p className="text-[15px] font-semibold text-slate-950">{template.template_name}</p><p className="mt-1 text-[12px] font-semibold uppercase text-blue-700">{template.channel}</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-semibold text-slate-600">default</span></div><p className="mt-4 text-[13px] font-semibold text-slate-800">{template.subject || "SMS template"}</p><pre className="mt-3 whitespace-pre-wrap rounded-2xl bg-slate-50 p-4 text-[12px] leading-6 text-slate-600">{template.message_body}</pre><p className="mt-3 text-[11px] font-semibold text-slate-400">Variables: {template.variables.join(", ")}</p></article>)}</div>
      </section>
    </AppShell>
  );
}
