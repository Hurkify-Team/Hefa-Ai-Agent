import { ArrowRight } from "lucide-react";

const steps = [
  {
    title: "Select Category",
    description: "Choose the facility category (Sheet Tab)",
  },
  {
    title: "Read Portal",
    description: "Open facility in HEFAMAA portal and extract data",
  },
  {
    title: "Preview Data",
    description: "Review and confirm extracted information",
  },
  {
    title: "Save to Sheet",
    description: "Save to the appropriate Google Sheet",
  },
];

export function StepProgress() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-6 py-6 shadow-sm">
      <div className="grid gap-5 xl:grid-cols-4">
        {steps.map((step, index) => (
          <div className="relative flex items-start gap-4" key={step.title}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[13px] font-bold text-white shadow-[0_10px_18px_rgba(37,99,235,0.22)]">
              {index + 1}
            </span>
            <div className="min-w-0 pr-3">
              <h2 className="text-[13px] font-bold text-slate-950">{step.title}</h2>
              <p className="mt-1 max-w-[210px] text-[12px] leading-5 text-slate-600">
                {step.description}
              </p>
            </div>
            {index < steps.length - 1 ? (
              <ArrowRight className="absolute right-5 top-3 hidden h-5 w-5 text-slate-400 xl:block" />
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
