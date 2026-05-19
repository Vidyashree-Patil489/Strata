import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  Info,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Layers,
  Lightbulb,
  Loader2,
  GitMerge,
  Network,
  ShieldCheck,
  TrendingUp,
  Folder,
  Anchor,
} from "lucide-react";
import api from "../api/axios";
import { FileSnippet } from "../components/forensics/FileSnippet";

/* ─── Types matching /health/:repoId/insights ─────────────── */

type AnalyzerName =
  | "co-change-patterns"
  | "layer-hints"
  | "test-coverage-map"
  | "score-forecast"
  | "directory-hotspots"
  | "stable-foundations";

type Severity = "info" | "good" | "warning" | "critical";

interface InsightEvidence {
  files?: string[];
  metrics?: Record<string, number | string>;
}

interface Insight {
  id: string;
  analyzer: AnalyzerName;
  severity: Severity;
  title: string;
  description: string;
  evidence?: InsightEvidence;
  suggestion?: string;
}

interface InsightsResponse {
  repoId: string;
  repoFullName: string;
  generatedAt: string;
  snapshot: { score: number; computedAt: string } | null;
  analyzers: Record<AnalyzerName, { label: string; description: string }>;
  insights: Insight[];
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    good: number;
  };
}

interface Repo {
  _id: string;
  fullName: string;
}

const ANALYZER_ORDER: AnalyzerName[] = [
  "co-change-patterns",
  "layer-hints",
  "test-coverage-map",
  "score-forecast",
  "directory-hotspots",
  "stable-foundations",
];

const ANALYZER_ICON: Record<AnalyzerName, any> = {
  "co-change-patterns": GitMerge,
  "layer-hints":        Network,
  "test-coverage-map":  ShieldCheck,
  "score-forecast":     TrendingUp,
  "directory-hotspots": Folder,
  "stable-foundations": Anchor,
};

const SEV_META: Record<
  Severity,
  { icon: any; color: string; bg: string; border: string; label: string }
> = {
  critical: {
    icon: AlertCircle,
    color: "#b91c1c",
    bg: "rgba(185, 28, 28, 0.08)",
    border: "rgba(185, 28, 28, 0.30)",
    label: "Critical",
  },
  warning: {
    icon: AlertTriangle,
    color: "#a16207",
    bg: "rgba(202, 138, 4, 0.10)",
    border: "rgba(202, 138, 4, 0.30)",
    label: "Warning",
  },
  info: {
    icon: Info,
    color: "#0a0a0a",
    bg: "rgba(120, 113, 108, 0.08)",
    border: "rgba(120, 113, 108, 0.25)",
    label: "Info",
  },
  good: {
    icon: CheckCircle,
    color: "#15803d",
    bg: "rgba(21, 128, 61, 0.08)",
    border: "rgba(21, 128, 61, 0.30)",
    label: "Healthy",
  },
};

/**
 * Repo Insights — synthesises the 4 indexing agents' outputs into actionable
 * cards through 6 analyzer lenses. No new agents run here; this is pure
 * derivation from already-indexed data.
 */
export default function Insights() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [data, setData] = useState<InsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    api
      .get("/repos")
      .then(({ data }) => {
        const list = (data.repos || []).map((r: any) => ({
          _id: r._id,
          fullName: r.fullName,
        }));
        setRepos(list);
        if (list.length === 0) navigate("/dashboard/repos");
      })
      .finally(() => setReposLoading(false));
  }, [navigate]);

  const activeRepoId = searchParams.get("repoId") || repos[0]?._id;
  const activeRepo = repos.find((r) => r._id === activeRepoId);

  useEffect(() => {
    if (!activeRepoId) return;
    setLoading(true);
    setError(null);
    api
      .get(`/health/${activeRepoId}/insights`)
      .then(({ data }) => setData(data))
      .catch((err) => {
        setData(null);
        setError(err);
      })
      .finally(() => setLoading(false));
  }, [activeRepoId]);

  const Header = (
    <div className="flex items-end justify-between gap-4 mb-8 pb-6 border-b border-border">
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] font-medium text-muted-foreground mb-2">
          Repo Insights
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight leading-none">
          {activeRepo?.fullName || "Cross-signal analysis"}
        </h1>
        <p className="mt-3 text-[13px] text-muted-foreground max-w-2xl leading-relaxed">
          Six lenses derive patterns from the indexed data that you can't see
          on any other page — hidden coupling, layer violations, missing
          tests, score forecasts, directory hotspots, and stable foundations.
          Each card combines signals; none repeats Forensics.
        </p>
      </div>

      {repos.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="clay-btn px-3 py-2 text-[12.5px] flex items-center gap-2 min-w-[220px] justify-between"
          >
            <span className="truncate">
              {activeRepo?.fullName || "Select repo"}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            />
          </button>
          {dropdownOpen && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-md py-1 z-50 w-72 max-h-72 overflow-auto">
              {repos.map((r) => (
                <button
                  key={r._id}
                  onClick={() => {
                    setSearchParams({ repoId: r._id });
                    setDropdownOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[12px] truncate ${
                    r._id === activeRepoId
                      ? "bg-muted text-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {r.fullName}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (reposLoading || loading) {
    return (
      <div>
        {Header}
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground mb-4">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Running analyzers…
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="clay-card p-5 h-32 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error?.response?.status === 404) {
    return (
      <div>
        {Header}
        <div className="clay-card p-10 flex flex-col items-center text-center">
          <Lightbulb className="w-6 h-6 text-muted-foreground" />
          <h3 className="mt-4 text-[15px] font-semibold">No insights yet</h3>
          <p className="mt-2 text-[13px] text-muted-foreground max-w-sm">
            This repo hasn't been indexed yet. Trigger an index from the Repos
            page and insights will appear here.
          </p>
          <button
            onClick={() => navigate("/dashboard/repos")}
            className="mt-5 clay-btn clay-btn-primary px-4 py-2 text-[12.5px]"
          >
            Go to Repos
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        {Header}
        <div className="clay-card p-5 flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[13px] font-medium text-destructive">
              Failed to load insights
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {error?.response?.data?.error || error?.message}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      {Header}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-8">
        <SummaryCard
          icon={Sparkles}
          label="Insights"
          value={data.summary.total}
          sub={`${ANALYZER_ORDER.length} analyzers`}
        />
        <SummaryCard
          icon={AlertCircle}
          label="Critical"
          value={data.summary.critical}
          color={data.summary.critical > 0 ? SEV_META.critical.color : undefined}
        />
        <SummaryCard
          icon={AlertTriangle}
          label="Warning"
          value={data.summary.warning}
          color={data.summary.warning > 0 ? SEV_META.warning.color : undefined}
        />
        <SummaryCard
          icon={Info}
          label="Info"
          value={data.summary.info}
        />
        <SummaryCard
          icon={CheckCircle}
          label="Healthy"
          value={data.summary.good}
          color={data.summary.good > 0 ? SEV_META.good.color : undefined}
        />
      </div>

      {/* Per-analyzer sections */}
      {ANALYZER_ORDER.map((name) => {
        const meta = data.analyzers[name];
        const items = data.insights.filter((i) => i.analyzer === name);
        const Icon = ANALYZER_ICON[name];
        if (!items.length) return null;
        return (
          <section key={name} className="mb-8">
            <div className="mb-4 pb-3 border-b border-border flex items-start gap-3">
              <div className="w-7 h-7 rounded-md border border-border bg-card flex items-center justify-center shrink-0 mt-0.5">
                <Icon className="w-3.5 h-3.5 text-foreground" />
              </div>
              <div>
                <h2 className="text-[15px] font-semibold tracking-tight">
                  {meta.label}
                </h2>
                <p className="text-[12px] text-muted-foreground mt-0.5 leading-relaxed max-w-3xl">
                  {meta.description}
                </p>
              </div>
              <span className="ml-auto text-[11px] text-muted-foreground tabular-nums shrink-0 mt-1">
                {items.length} card{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="space-y-3">
              {items.map((i) => (
                <InsightCard
                  key={i.id}
                  insight={i}
                  repoId={activeRepoId!}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* ─── Building blocks ─────────────────────────────────────── */

function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: any;
  label: string;
  value: number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="clay-card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon
          className="w-3 h-3"
          style={{ color: color ?? "var(--muted-foreground)" }}
        />
        <span className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <p
        className="text-[22px] font-semibold tracking-tight tabular-nums leading-none"
        style={{ color: color ?? "inherit" }}
      >
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted-foreground mt-1.5">{sub}</p>}
    </div>
  );
}

function InsightCard({
  insight,
  repoId,
}: {
  insight: Insight;
  repoId: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const sev = SEV_META[insight.severity];
  const SevIcon = sev.icon;
  const files = insight.evidence?.files ?? [];
  const metrics = insight.evidence?.metrics
    ? Object.entries(insight.evidence.metrics)
    : [];

  return (
    <div
      className="clay-card p-4 border"
      style={{ borderColor: sev.border, background: sev.bg }}
    >
      {/* Header row */}
      <div className="flex items-start gap-3">
        <div
          className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
          style={{ background: "var(--card)", border: `1px solid ${sev.border}` }}
        >
          <SevIcon className="w-3.5 h-3.5" style={{ color: sev.color }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <h3 className="text-[13.5px] font-semibold tracking-tight">
              {insight.title}
            </h3>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider"
              style={{
                color: sev.color,
                background: "var(--card)",
                border: `1px solid ${sev.border}`,
              }}
            >
              {sev.label}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-foreground/80 leading-relaxed whitespace-pre-line">
            {insight.description}
          </p>
        </div>
      </div>

      {/* Metrics chips */}
      {metrics.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 pl-9">
          {metrics.map(([k, v]) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-card text-[10.5px] font-mono"
            >
              <span className="text-muted-foreground">{k}</span>
              <span className="tabular-nums">{String(v)}</span>
            </span>
          ))}
        </div>
      )}

      {/* Suggestion */}
      {insight.suggestion && (
        <div className="mt-3 pl-9 flex items-start gap-2 text-[12px]">
          <Lightbulb
            className="w-3.5 h-3.5 shrink-0 mt-0.5"
            style={{ color: sev.color }}
          />
          <p className="text-foreground/80 leading-relaxed">
            {insight.suggestion}
          </p>
        </div>
      )}

      {/* Files — expandable inline snippets */}
      {files.length > 0 && (
        <div className="mt-3 pl-9">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
            Affected files ({files.length})
          </div>
          <div className="space-y-1.5">
            {files.slice(0, 5).map((path) => {
              const isOpen = expanded === path;
              return (
                <div key={path}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : path)}
                    className="flex items-center gap-1.5 text-[11.5px] font-mono text-foreground/80 hover:text-foreground transition-colors"
                  >
                    <ChevronRight
                      className={`w-3 h-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
                    />
                    <span className="truncate" title={path}>
                      {path}
                    </span>
                  </button>
                  {isOpen && (
                    <div className="mt-1.5 ml-4">
                      <FileSnippet
                        repoId={repoId}
                        path={path}
                        defaultExpanded
                        previewLines={40}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {files.length > 5 && (
              <p className="text-[10.5px] text-muted-foreground pl-4">
                +{files.length - 5} more
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
