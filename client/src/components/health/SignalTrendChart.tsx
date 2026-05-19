import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell,
  LabelList,
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

const SIGNALS = [
  { key: "coupling",   name: "Coupling",    color: "#a16207", desc: "Gini of PageRank — lower is better" },
  { key: "churnRisk",  name: "Churn risk",  color: "#b91c1c", desc: "Hot-file count — lower is better" },
  { key: "debt",       name: "Debt",        color: "#be185d", desc: "Reserved · default 0" },
  { key: "confidence", name: "Confidence",  color: "#15803d", desc: "Reserved · default 70%" },
];

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="bg-card border border-border rounded-md px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="font-medium text-foreground">{p.name}</p>
      <p className="font-mono tabular-nums" style={{ color: p.color }}>
        {Math.round(p.value * 100)}%
      </p>
      <p className="text-[10.5px] text-muted-foreground mt-0.5">{p.desc}</p>
    </div>
  );
};

export function SignalTrendChart({ data }: Props) {
  if (data.length === 0) return null;

  // Take the latest snapshot — bars will always be distinct heights for the
  // four signals, so the chart always reads as "alive" even with one snapshot.
  const latest = data[data.length - 1];
  const bars = SIGNALS.map((s) => ({
    name: s.name,
    value: (latest as any)[s.key] as number,
    color: s.color,
    desc: s.desc,
  }));

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[12px] font-medium">Signal breakdown</p>
        <p className="text-[11px] text-muted-foreground">
          Latest snapshot · {data.length}{" "}
          {data.length === 1 ? "indexing run" : "indexing runs"}
        </p>
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={bars}
          layout="vertical"
          margin={{ top: 4, right: 44, left: 4, bottom: 4 }}
          barCategoryGap={12}
        >
          <CartesianGrid horizontal={false} stroke="#e7e5e4" strokeDasharray="3 3" />
          <XAxis
            type="number"
            domain={[0, 1]}
            tick={{ fontSize: 11, fill: "#57534e" }}
            tickFormatter={(v) => `${Math.round(v * 100)}%`}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="name"
            tick={{ fontSize: 11, fill: "#0a0a0a" }}
            axisLine={false}
            tickLine={false}
            width={92}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "#f5f5f4" }} />
          <Bar dataKey="value" radius={[3, 3, 3, 3]} isAnimationActive={false}>
            {bars.map((b, i) => (
              <Cell key={i} fill={b.color} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: any) => `${Math.round(v * 100)}%`}
              style={{ fontSize: 11, fill: "#0a0a0a", fontFamily: "var(--font-mono)" }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
