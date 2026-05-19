import { Calculator } from "lucide-react";

interface Signals {
  coupling:   { normalized: number };
  churnRisk:  { normalized: number };
  debt:       { normalized: number };
  confidence: { normalized: number };
}

interface Props {
  score: number;
  signals: Signals;
  smells: { hitCount: number; normalized: number };
  computedAt: string;
}

interface Row {
  label: string;
  color: string;
  input: number;          // 0..1
  weight: number;         // multiplier
  sign: "+" | "-";        // contribution direction
  contribution: number;   // signed dollars
  note: string;
}

/**
 * Live score breakdown — shows each term of the composite formula plugged
 * in with the current snapshot's values. The math here mirrors
 * computeAndSaveHealthScore exactly:
 *
 *   raw   = 100 - coupling*35 - churnRisk*35 - smells*20 + confidence*10
 *   score = clamp(round(raw), 0, 100)
 *
 * (Debt is reserved — its normalized value isn't in the formula today, so
 * we show it greyed out with weight 0 so the user can see why.)
 */
export function ScoreBreakdown({ score, signals, smells, computedAt }: Props) {
  const couplingIn   = Number(signals.coupling.normalized)   || 0;
  const churnIn      = Number(signals.churnRisk.normalized)  || 0;
  const smellsIn     = Number(smells?.normalized)            || 0;
  const debtIn       = Number(signals.debt.normalized)       || 0;
  const confidenceIn = Number(signals.confidence.normalized) || 0;

  const rows: Row[] = [
    {
      label: "Coupling",
      color: "#a16207",
      input: couplingIn,
      weight: 35,
      sign: "-",
      contribution: -couplingIn * 35,
      note: "Gini of PageRank · 0=spread, 1=concentrated",
    },
    {
      label: "Churn risk",
      color: "#b91c1c",
      input: churnIn,
      weight: 35,
      sign: "-",
      contribution: -churnIn * 35,
      note: "Hot files ÷ 10, capped at 1",
    },
    {
      label: "Semantic findings",
      color: "#7c3aed",
      input: smellsIn,
      weight: 20,
      sign: "-",
      contribution: -smellsIn * 20,
      note: `Anti-patterns from dep graph · ${smells?.hitCount ?? 0} hit${(smells?.hitCount ?? 0) === 1 ? "" : "s"}`,
    },
    {
      label: "Debt",
      color: "#be185d",
      input: debtIn,
      weight: 0,
      sign: "-",
      contribution: 0,
      note: "Reserved · not in current formula",
    },
    {
      label: "Confidence",
      color: "#15803d",
      input: confidenceIn,
      weight: 10,
      sign: "+",
      contribution: +confidenceIn * 10,
      note: "Reserved baseline · default 70%",
    },
  ];

  const sumContributions = rows.reduce((s, r) => s + r.contribution, 0);
  const rawScore = 100 + sumContributions;
  // Final clamped score should mirror what the server stored on the snapshot.
  const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));
  const clampWarning =
    rawScore < 0 || rawScore > 100
      ? ` (clamped from ${Math.round(rawScore)})`
      : "";

  const computedAtLabel = new Date(computedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <div className="flex items-center gap-2">
          <Calculator className="w-3.5 h-3.5 text-muted-foreground" />
          <p className="text-[12px] font-medium">Score breakdown</p>
        </div>
        <p className="text-[11px] text-muted-foreground tabular-nums">
          {computedAtLabel}
        </p>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        {/* Base row */}
        <div className="grid grid-cols-[5rem_1fr_5rem_4rem] gap-3 items-center px-3 py-2 bg-muted/40 border-b border-border">
          <span className="text-[12.5px] font-mono font-semibold tabular-nums text-foreground">
            +100
          </span>
          <span className="text-[12px] font-medium">Base score</span>
          <span className="text-[10.5px] text-muted-foreground"></span>
          <span className="text-[10.5px] text-muted-foreground text-right">
            (every repo starts here)
          </span>
        </div>

        {/* Signal contribution rows */}
        {rows.map((r) => {
          const reserved = r.weight === 0;
          const contribStr = reserved
            ? "—"
            : `${r.sign === "+" ? "+" : "−"}${Math.abs(r.contribution).toFixed(2)}`;
          return (
            <div
              key={r.label}
              className="grid grid-cols-[5rem_1fr_5rem_4rem] gap-3 items-center px-3 py-2 border-b border-border last:border-b-0"
            >
              <span
                className="text-[12.5px] font-mono font-semibold tabular-nums"
                style={{
                  color: reserved
                    ? "var(--muted-foreground)"
                    : r.sign === "+"
                      ? "#15803d"
                      : r.contribution === 0
                        ? "var(--muted-foreground)"
                        : "#b91c1c",
                }}
              >
                {contribStr}
              </span>

              <span className="flex items-center gap-2 min-w-0">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: r.color, opacity: reserved ? 0.4 : 1 }}
                />
                <span className="min-w-0">
                  <p
                    className="text-[12px] font-medium truncate"
                    style={{ opacity: reserved ? 0.6 : 1 }}
                  >
                    {r.label}
                  </p>
                  <p className="text-[10.5px] text-muted-foreground truncate">
                    {r.note}
                  </p>
                </span>
              </span>

              <span
                className="text-[11px] font-mono tabular-nums text-muted-foreground text-right"
                style={{ opacity: reserved ? 0.5 : 1 }}
                title="signal value · 0–100%"
              >
                {Math.round(r.input * 100)}%
              </span>

              <span
                className="text-[10.5px] font-mono tabular-nums text-muted-foreground text-right"
                style={{ opacity: reserved ? 0.5 : 1 }}
                title="weight in composite formula"
              >
                ×{r.weight}
              </span>
            </div>
          );
        })}

        {/* Final row */}
        <div className="grid grid-cols-[5rem_1fr] gap-3 items-baseline px-3 py-3 bg-muted/40 border-t border-border">
          <span
            className="text-[20px] font-mono font-semibold tabular-nums leading-none"
            style={{
              color:
                finalScore >= 80
                  ? "#15803d"
                  : finalScore >= 60
                    ? "#a16207"
                    : "#b91c1c",
            }}
          >
            {finalScore}
          </span>
          <span>
            <p className="text-[12px] font-medium">
              Final score{clampWarning}
            </p>
            <p className="text-[10.5px] text-muted-foreground mt-0.5 font-mono">
              100 − {(couplingIn * 35).toFixed(2)} − {(churnIn * 35).toFixed(2)}{" "}
              − {(smellsIn * 20).toFixed(2)} + {(confidenceIn * 10).toFixed(2)}{" "}
              = {Math.round(rawScore)}
            </p>
          </span>
        </div>
      </div>

      <p className="text-[10.5px] text-muted-foreground mt-3 leading-relaxed">
        Lower coupling / churn / smells push the score up; higher confidence
        pushes it up. Debt is wired for a future PR-review pipeline and
        currently has weight 0.
      </p>
    </div>
  );
}
