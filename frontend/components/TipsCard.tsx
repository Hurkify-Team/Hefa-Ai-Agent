import { Lightbulb } from "lucide-react";

const tips = [
  "Ensure all important fields are captured.",
  "You can edit any value before saving.",
  "Use search to find existing facilities.",
];

export function TipsCard() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 flex items-center gap-2 text-[15px] font-bold text-slate-950">
        <Lightbulb className="h-4 w-4 text-amber-500" />
        Tips
      </h2>
      <ul className="space-y-3 text-[13px] text-slate-800">
        {tips.map((tip) => (
          <li className="flex items-start gap-3" key={tip}>
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-slate-700" />
            <span>{tip}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
