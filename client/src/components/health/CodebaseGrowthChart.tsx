import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface DataPoint {
  computedAt: string;
  totalFiles: number;
  totalDefs: number;
}

interface Props {
  data: DataPoint[];
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-md px-2.5 py-1.5 text-[11px] shadow-sm">
      <p className="text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} className="font-medium tabular-nums" style={{ color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
};

export function CodebaseGrowthChart({ data }: Props) {
  const formatted = data.map((d) => ({
    date: new Date(d.computedAt).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    files: d.totalFiles,
    definitions: d.totalDefs,
  }));

  if (formatted.length === 0) return null;

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[12px] font-medium">Codebase growth</p>
        <p className="text-[11px] text-muted-foreground">
          Files &amp; definitions over time
        </p>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={formatted} margin={{ left: -10, right: 8, top: 4 }}>
          <defs>
            <linearGradient id="grad-defs" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="grad-files" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ stroke: "var(--border)" }} />
          <Area
            type="monotone"
            dataKey="definitions"
            name="Definitions"
            stroke="var(--chart-1)"
            fill="url(#grad-defs)"
            strokeWidth={1.5}
          />
          <Area
            type="monotone"
            dataKey="files"
            name="Files"
            stroke="var(--chart-2)"
            fill="url(#grad-files)"
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>

      <div className="flex items-center gap-4 mt-4 pt-4 border-t border-border">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-0.5 rounded-full" style={{ background: "var(--chart-1)" }} />
          <span className="text-[11px] text-muted-foreground">Definitions</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-0.5 rounded-full" style={{ background: "var(--chart-2)" }} />
          <span className="text-[11px] text-muted-foreground">Files</span>
        </div>
      </div>
    </div>
  );
}
