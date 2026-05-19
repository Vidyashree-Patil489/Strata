import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface Point {
  score: number;
  computedAt: string;
}

interface Props {
  data: Point[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="text-muted-foreground mb-0.5">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium tabular-nums text-foreground">
          Score: {p.value}
        </p>
      ))}
    </div>
  );
};

function buildLabels(data: Point[]): string[] {
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

export function TrendChart({ data }: Props) {
  if (data.length === 0) return null;

  const labels = buildLabels(data);
  const formatted = data.map((d, i) => ({
    score: d.score,
    date: labels[i],
  }));

  const showDots = formatted.length < 8;

  // Detect whether the score actually moved between snapshots.
  const scores = formatted.map((d) => d.score);
  const minScore = Math.min(...scores);
  const maxScore = Math.max(...scores);
  const isStable = formatted.length > 1 && minScore === maxScore;

  // Pad the Y range when variance is small so flat lines sit mid-chart,
  // not pinned to the top or bottom edge.
  const yDomain: [number, number] =
    isStable
      ? [Math.max(0, minScore - 15), Math.min(100, maxScore + 15)]
      : [0, 100];

  const subtitle =
    formatted.length === 1
      ? "Single snapshot — re-index to build trend"
      : isStable
        ? `Stable at ${minScore} across ${formatted.length} snapshots`
        : `${formatted.length} snapshots · ${minScore}–${maxScore}`;

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[12px] font-medium">Health trend</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={formatted} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "#57534e" }}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 11, fill: "#57534e" }}
            width={28}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "#e7e5e4", strokeWidth: 1 }} />
          <ReferenceLine
            y={80}
            stroke="#15803d"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
          />
          <ReferenceLine
            y={60}
            stroke="#a16207"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="#0a0a0a"
            strokeWidth={1.5}
            dot={showDots ? { r: 2.5, fill: "#0a0a0a", strokeWidth: 0 } : false}
            activeDot={{ r: 3, fill: "#0a0a0a" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
