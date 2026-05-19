import { AlertTriangle } from "lucide-react";

interface Props {
  score: number;
  computedAt: string;
}

/**
 * Big, type-driven score card. No gauge ring — editorial style favors a
 * giant numeral over chrome. A small accent bar at the bottom encodes
 * "healthy/watch/critical" without garish color blocks.
 */
export function ScoreGauge({ score, computedAt }: Props) {
  const tier =
    score >= 80 ? "healthy" : score >= 60 ? "watch" : "critical";
  const tierLabel =
    tier === "healthy" ? "Healthy" : tier === "watch" ? "Watch" : "Critical";
  const accent =
    tier === "healthy"
      ? "var(--chart-5)" // green-700
      : tier === "watch"
        ? "var(--chart-3)" // amber-700
        : "var(--destructive)";

  const isStale =
    Date.now() - new Date(computedAt).getTime() > 7 * 86400000;

  return (
    <div className="clay-card p-6 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
          Health score
        </p>
        {isStale && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <AlertTriangle className="w-3 h-3" />
            Stale &gt; 7d
          </span>
        )}
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span
          className="text-[64px] leading-none font-semibold tracking-tight tabular-nums"
          style={{ color: "var(--foreground)" }}
        >
          {score}
        </span>
        <span className="text-[18px] text-muted-foreground font-mono tabular-nums">
          / 100
        </span>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{ background: accent }}
        />
        <span
          className="text-[12px] font-medium"
          style={{ color: accent }}
        >
          {tierLabel}
        </span>
      </div>

      {/* Tier scale — one tick highlighted */}
      <div className="mt-6 grid grid-cols-3 gap-1">
        {(["critical", "watch", "healthy"] as const).map((t) => {
          const active = t === tier;
          const c =
            t === "healthy"
              ? "var(--chart-5)"
              : t === "watch"
                ? "var(--chart-3)"
                : "var(--destructive)";
          return (
            <div key={t} className="space-y-1">
              <div
                className="h-1 rounded-full"
                style={{
                  background: active ? c : "var(--border)",
                }}
              />
              <p
                className={`text-[10px] ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-auto pt-6 text-[11px] text-muted-foreground">
        Updated {new Date(computedAt).toLocaleString()}
      </p>
    </div>
  );
}
