type SignalType = "coupling" | "churnRisk" | "debt" | "confidence";

const SIGNAL_META: Record<
  SignalType,
  { label: string; description: (v: any) => string }
> = {
  coupling: {
    label: "Coupling",
    description: (v) =>
      v.normalized < 0.2
        ? "Modular — dependencies well distributed."
        : v.normalized < 0.5
          ? "Some centralization — a few key files."
          : "High coupling — load-bearing files detected.",
  },
  churnRisk: {
    label: "Churn risk",
    description: (v) =>
      v.hotFileCount === 0
        ? "No blast-radius files detected."
        : `${v.hotFileCount} central file${v.hotFileCount > 1 ? "s" : ""} changing frequently.`,
  },
  debt: {
    label: "Findings debt",
    description: (v) =>
      v.avgPerPR < 5
        ? "Low debt — clean review history."
        : v.avgPerPR < 20
          ? `${v.avgPerPR.toFixed(1)} avg weighted findings per PR.`
          : "High debt — recurring unresolved findings.",
  },
  confidence: {
    label: "AI confidence",
    description: (v) =>
      `${Math.round(v.rollingAvg)}/100 avg confidence across recent reviews.`,
  },
};

interface Props {
  signal: SignalType;
  value: any;
}

/**
 * Editorial signal card. Label, big mono number, one-line description,
 * thin track bar. No saturated fills.
 */
export function SignalCard({ signal, value }: Props) {
  const meta = SIGNAL_META[signal];
  const pct = Math.round(value.normalized * 100);

  // Color: for "confidence" higher is better; for others, lower is better.
  const good = signal === "confidence" ? pct >= 70 : pct < 40;
  const bad = signal === "confidence" ? pct < 40 : pct >= 70;
  const bar = good
    ? "var(--chart-5)"
    : bad
      ? "var(--destructive)"
      : "var(--chart-3)";

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-3">
        <p className="text-[12px] font-medium text-foreground">{meta.label}</p>
        <p
          className="text-[20px] font-mono font-medium tabular-nums leading-none"
          style={{ color: bar }}
        >
          {pct}
          <span className="text-[12px] text-muted-foreground font-mono ml-0.5">%</span>
        </p>
      </div>

      <div className="w-full h-[3px] bg-border rounded-full overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, background: bar }}
        />
      </div>

      <p className="text-[12px] text-muted-foreground leading-snug">
        {meta.description(value)}
      </p>
    </div>
  );
}
