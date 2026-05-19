import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface DataPoint {
  computedAt: string;
  coupling: number;
  churnRisk: number;
  debt: number;
  confidence: number;
}

interface Props {
  data: DataPoint[];
}

const SERIES = [
  { key: "coupling", name: "Coupling", color: "var(--chart-3)" },     // amber
  { key: "churnRisk", name: "Churn risk", color: "var(--destructive)" },
  { key: "debt", name: "Debt", color: "var(--chart-4)" },             // pink
  { key: "confidence", name: "Confidence", color: "var(--chart-5)" }, // green
];

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium tabular-nums" style={{ color: p.color }}>
          {p.name}: {Math.round(p.value * 100)}%
        </p>
      ))}
    </div>
  );
};

export function SignalTrendChart({ data }: Props) {
  const formatted = data.map((d) => ({
    date: new Date(d.computedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    coupling: d.coupling,
    churnRisk: d.churnRisk,
    debt: d.debt,
    confidence: d.confidence,
  }));

  if (formatted.length === 0) return null;

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[12px] font-medium">Signal trends</p>
        <p className="text-[11px] text-muted-foreground">Normalized 0–100%</p>
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={formatted} margin={{ left: -10, right: 8, top: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 1]}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border)" }} />
          {SERIES.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.name}
              stroke={s.color}
              strokeWidth={1.5}
              dot={false}
              activeDot={{ r: 3 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>

      <div className="flex items-center flex-wrap gap-x-4 gap-y-1.5 mt-4 pt-4 border-t border-border">
        {SERIES.map((s) => (
          <div key={s.key} className="flex items-center gap-1.5">
            <span
              className="w-2 h-[2px] rounded-full"
              style={{ background: s.color }}
            />
            <span className="text-[11px] text-muted-foreground">{s.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
