const PERIODS = [
  { label: "All time", value: "" },
  { label: "Last 7 days", value: "7d" },
  { label: "Last 30 days", value: "30d" },
] as const;

export type Period = "" | "7d" | "30d";

export function sinceFromPeriod(period: Period): string | undefined {
  if (!period) return undefined;
  const d = new Date();
  d.setDate(d.getDate() - (period === "7d" ? 7 : 30));
  return d.toISOString();
}

export default function PeriodSelector({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex gap-1" style={{ background: "var(--soft)", borderRadius: 10, padding: 3, border: "1px solid var(--border)" }}>
      {PERIODS.map((p) => (
        <button key={p.value} type="button"
          className={value === p.value ? "period-btn period-btn-active" : "period-btn"}
          onClick={() => onChange(p.value as Period)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
