interface Props {
  icon: any;
  label: string;
  value: string | number;
  color?: string;
  trend?: number;
}

/**
 * Compact stat card — label up top, big tabular number, optional trend
 * delta. No saturated color blocks; ink + muted does it.
 */
export function StatCard({ icon: Icon, label, value, trend }: Props) {
  const trendColor =
    trend && trend > 0
      ? "var(--chart-5)"
      : trend && trend < 0
        ? "var(--destructive)"
        : "var(--muted-foreground)";

  return (
    <div className="clay-card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
          {label}
        </span>
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
    </div>
  );
}
