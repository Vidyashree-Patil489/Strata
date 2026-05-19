import { useState } from "react";
import { Info } from "lucide-react";

interface Props {
  icon: any;
  label: string;
  value: string | number;
  color?: string;
  trend?: number;
  /** Optional one-line explanation revealed on click. */
  description?: string;
}

/**
 * Compact stat card — label up top, big tabular number, optional trend
 * delta. When a `description` is provided, the card becomes a button:
 * clicking it expands an inline explanation below the value (and reveals
 * an Info icon in the header). No popovers, no layout floats — just
 * grows in-place when toggled.
 */
export function StatCard({ icon: Icon, label, value, trend, description }: Props) {
  const [expanded, setExpanded] = useState(false);
  const interactive = !!description;

  const trendColor =
    trend && trend > 0
      ? "var(--chart-5)"
      : trend && trend < 0
        ? "var(--destructive)"
        : "var(--muted-foreground)";

  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
          {label}
        </span>
        {interactive && (
          <Info
            className={`w-2.5 h-2.5 ml-auto text-muted-foreground transition-opacity ${expanded ? "opacity-100" : "opacity-50"}`}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <p className="text-[22px] font-semibold tracking-tight tabular-nums leading-none">
          {value}
        </p>
        {trend !== undefined && trend !== 0 && (
          <span
            className="text-[11px] font-medium tabular-nums"
            style={{ color: trendColor }}
          >
            {trend > 0 ? "+" : ""}
            {trend}
          </span>
        )}
      </div>
      {interactive && expanded && (
        <p className="text-[11px] text-muted-foreground mt-2.5 leading-relaxed">
          {description}
        </p>
      )}
    </>
  );

  if (!interactive) {
    return <div className="clay-card p-4">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={`${label}: ${value}. ${expanded ? "Hide" : "Show"} explanation.`}
      className="clay-card p-4 text-left w-full cursor-pointer hover:bg-muted/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {body}
    </button>
  );
}
