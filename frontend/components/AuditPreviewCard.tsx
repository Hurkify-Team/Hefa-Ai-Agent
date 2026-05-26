type AuditPreviewCardProps = {
  action?: string;
  category?: string;
  facilityName?: string;
  status?: string;
  time?: string;
};

export function AuditPreviewCard({
  action = "Add New Facility",
  category = "LABORATORY",
  facilityName,
  status = "Ready",
  time = "Pending confirmation",
}: AuditPreviewCardProps) {
  const auditRows = [
    ["Action", action],
    ["Category", category],
    ["Facility", facilityName || "-"],
    ["Status", status],
    ["User", "Admin User"],
    ["Time", time],
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-[15px] font-bold text-slate-950">Audit Log Preview</h2>
      <dl className="space-y-2">
        {auditRows.map(([label, value]) => (
          <div className="grid grid-cols-[95px_1fr] gap-4 text-[13px]" key={label}>
            <dt className="text-slate-500">{label}</dt>
            <dd className="font-semibold text-slate-950">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
