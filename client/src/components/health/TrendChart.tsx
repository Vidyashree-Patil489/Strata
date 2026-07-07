import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface Point {
  score: number;
  computedAt: string;
}

interface Props {
  data: Point[];
  /** Optional — start of the timeline (e.g. earliest tracked push). If
   *  given together with `rangeEnd`, the X-axis becomes a continuous
   *  time scale spanning that full range instead of one tick per point. */
  rangeStart?: string;
  rangeEnd?: string;
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-md px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="text-muted-foreground mb-0.5">{p.tooltipLabel}</p>
      <p className="font-medium tabular-nums text-foreground">
        Score: {p.score}
      </p>
    </div>
  );
};

function formatCategoryLabels(data: Point[]): string[] {
  const dayCounts = new Map<string, number>();
  for (const d of data) {
    const day = new Date(d.computedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
  }
  return data.map((d) => {
    const dt = new Date(d.computedAt);
    const day = dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    if ((dayCounts.get(day) ?? 0) > 1) {
      const time = dt.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      });
      return `${day} ${time}`;
    }
    return day;
  });
}

/** Full "Mon D, YYYY" — used as the tooltip caption. */
function fullLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Compact tick used on the time-based X-axis. Prefers "Mon YYYY" when
 *  the range spans multiple months (which it almost always will for a
 *  real repo). */
function timeTick(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

export function TrendChart({ data, rangeStart, rangeEnd }: Props) {
  if (data.length === 0) return null;

  const useTimeAxis = !!(rangeStart && rangeEnd);

  const scores = data.map((d) => d.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const isStable = data.length > 1 && minScore === maxScore;

  const yDomain: [number, number] =
    isStable
      ? [Math.max(0, minScore - 15), Math.min(100, maxScore + 15)]
      : [0, 100];

  const subtitle =
    data.length === 1
      ? "Single snapshot — re-index to build trend"
      : isStable
        ? `Stable at ${minScore} across ${data.length} snapshots`
        : `${data.length} snapshots · ${minScore}–${maxScore}`;

  const LINE_COLOR = "#2563eb";

  // Two shapes depending on axis type:
  //   time axis    → { ts, score, tooltipLabel }
  //   category axis → { date, score, tooltipLabel }
  // Widened to `any` so both branches typecheck against Recharts'
  // ChartData<T> — the actual runtime shape is safe since XAxis is
  // configured differently per branch.
  const formatted: any[] = useTimeAxis
    ? data.map((d) => ({
        ts: new Date(d.computedAt).getTime(),
        score: d.score,
        tooltipLabel: fullLabel(d.computedAt),
      }))
    : (() => {
        const labels = formatCategoryLabels(data);
        return data.map((d, i) => ({
          date: labels[i],
          score: d.score,
          tooltipLabel: fullLabel(d.computedAt),
        }));
      })();

  const xDomain: [number, number] | undefined = useTimeAxis
    ? [
        new Date(rangeStart!).getTime(),
        new Date(rangeEnd!).getTime(),
      ]
    : undefined;

  // Generate ~5 evenly-spaced ticks across the range so the axis has
  // some structure even when we only have one or two snapshots.
  const timeTicks: number[] | undefined = xDomain
    ? Array.from({ length: 5 }, (_, i) =>
        Math.round(xDomain[0] + ((xDomain[1] - xDomain[0]) * i) / 4),
      )
    : undefined;

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[12px] font-medium">Health trend</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={formatted} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={LINE_COLOR} stopOpacity={0.28} />
              <stop offset="100%" stopColor={LINE_COLOR} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            vertical={false}
            stroke="#e7e5e4"
            strokeDasharray="3 3"
          />
          {useTimeAxis ? (
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={xDomain}
              ticks={timeTicks}
              tickFormatter={timeTick}
              tick={{ fontSize: 11, fill: "#57534e" }}
              axisLine={false}
              tickLine={false}
            />
          ) : (
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: "#57534e" }}
              interval="preserveStartEnd"
              axisLine={false}
              tickLine={false}
            />
          )}
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: "#57534e" }}
            width={32}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<CustomTooltip />}
            cursor={{ stroke: "#94a3b8", strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <ReferenceLine
            y={80}
            stroke="#15803d"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <ReferenceLine
            y={60}
            stroke="#a16207"
            strokeDasharray="3 3"
            strokeOpacity={0.5}
          />
          <Area
            type="monotone"
            dataKey="score"
            stroke={LINE_COLOR}
            strokeWidth={2}
            fill="url(#trendFill)"
            fillOpacity={1}
            dot={{
              r: 3.5,
              fill: "#ffffff",
              stroke: LINE_COLOR,
              strokeWidth: 2,
            }}
            activeDot={{
              r: 5,
              fill: LINE_COLOR,
              stroke: "#ffffff",
              strokeWidth: 2,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
