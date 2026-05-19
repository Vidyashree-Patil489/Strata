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

export function TrendChart({ data }: Props) {
  const formatted = data.map((d) => ({
    score: d.score,
    date: new Date(d.computedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
  }));

  if (formatted.length === 0) return null;

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[12px] font-medium">Health trend</p>
        <p className="text-[11px] text-muted-foreground">Last 90 days</p>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={formatted} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            interval="preserveStartEnd"
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            width={28}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border)", strokeWidth: 1 }} />
          <ReferenceLine
            y={80}
            stroke="var(--chart-5)"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
          />
          <ReferenceLine
            y={60}
            stroke="var(--chart-3)"
            strokeDasharray="3 3"
            strokeOpacity={0.6}
          />
          <Line
            type="monotone"
            dataKey="score"
            stroke="var(--foreground)"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3, fill: "var(--foreground)" }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
