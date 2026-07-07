import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ChevronDown,
  Activity,
  TrendingUp,
  FileCode,
  GitBranch,
  Clock,
  BarChart3,
  Coins,
  ArrowUpRight,
} from "lucide-react";
import api from "../api/axios";
import { ScoreGauge } from "../components/health/ScoreGauge";
import { EmptyHealth } from "../components/health/EmptyHealth";
import { SignalCard } from "../components/health/SignalCard";
import { TrendChart } from "../components/health/TrendChart";
import { HotFileList } from "../components/health/HotFileList";
import { StatCard } from "../components/health/StatCard";
import { CommitTimeline } from "../components/health/CommitTimeline";
import { SignalTrendChart } from "../components/health/SignalTrendChart";
import { CodebaseGrowthChart } from "../components/health/CodebaseGrowthChart";
import { ScoreBreakdown } from "../components/health/ScoreBreakdown";

interface Repo {
  _id: string;
  fullName: string;
}

interface HealthSnapshot {
  repoId: string;
  repoFullName: string;
  score: number;
  signals: {
    coupling: { gini: number; normalized: number };
    churnRisk: { hotFileCount: number; normalized: number };
    debt: { weightedTotal: number; avgPerPR: number; normalized: number };
    confidence: { rollingAvg: number; normalized: number };
  };
  /** Top-level (not under `signals`) — same shape as the snapshot stores it. */
  smells: { hitCount: number; normalized: number };
  hotFiles: string[];
  totalFiles: number;
  totalDefs: number;
  prCount: number;
  computedAt: string;
  recentPushes: Array<{
    commitSha: string;
    files: string[];
    pushedAt: string;
    fileDiffs: Array<{
      filename: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>;
  }>;
  metrics: {
    totalSnapshots: number;
    scoreChange: number;
    daysTracked: number;
  };
}

interface HistoryPoint {
  score: number;
  computedAt: string;
  gini: number;
  hotFileCount: number;
  coupling: number;
  churnRisk: number;
  debt: number;
  confidence: number;
  /** 0..1 normalized smell signal — 0 on snapshots predating semantic analysis. */
  smells: number;
  smellCount: number;
  totalFiles: number;
  totalDefs: number;
}

/**
 * Strata — main health dashboard. Repo picker in the header, hero score
 * on the left, signal breakdown on the right, then stats / trend / commit
 * timeline / signal+growth charts / hot files.
 */
export default function RepoHealth() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<HealthSnapshot | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [snapLoading, setSnapLoading] = useState(false);
  const [snapError, setSnapError] = useState<any>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [costSummary, setCostSummary] = useState<{
    totalUsd: number;
    callCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  } | null>(null);

  useEffect(() => {
    const fetchRepos = async () => {
      try {
        const { data } = await api.get("/repos");
        const list = (data.repos || []).map((r: any) => ({
          _id: r._id,
          fullName: r.fullName,
        }));
        setRepos(list);
        if (list.length === 0) navigate("/dashboard/repos");
      } catch (err) {
        console.error("Failed to fetch repos:", err);
      } finally {
        setReposLoading(false);
      }
    };
    fetchRepos();
  }, [navigate]);

  const activeRepoId = searchParams.get("repoId") || repos[0]?._id;
  const activeRepo = repos.find((r) => r._id === activeRepoId);

  useEffect(() => {
    if (!activeRepoId) return;
    const fetchData = async () => {
      setSnapLoading(true);
      setSnapError(null);
      try {
        const { data: snap } = await api.get(`/health/${activeRepoId}/latest`);
        setSnapshot(snap);
        try {
          const { data: hist } = await api.get(
            `/health/${activeRepoId}/history?days=90`,
          );
          setHistory(hist.history || []);
        } catch {
          setHistory([]);
        }
      } catch (err: any) {
        setSnapError(err);
        setSnapshot(null);
        setHistory([]);
      } finally {
        setSnapLoading(false);
      }

      // Cost is non-blocking — failure leaves the card hidden.
      try {
        const { data: costs } = await api.get(
          `/health/${activeRepoId}/costs?days=30`,
        );
        setCostSummary(costs.totals);
      } catch {
        setCostSummary(null);
      }
    };
    fetchData();
  }, [activeRepoId]);

  const handleRepoChange = (id: string) => {
    setSearchParams({ repoId: id });
    setDropdownOpen(false);
  };

  const handleRetry = () => {
    if (!activeRepoId) return;
    setSnapError(null);
    setSnapLoading(true);
    api
      .get(`/health/${activeRepoId}/latest`)
      .then(({ data }) => setSnapshot(data))
      .catch((err) => setSnapError(err))
      .finally(() => setSnapLoading(false));
  };

  /** Single source for the page header so layout doesn't jump between states. */
  const Header = (
    <div className="flex items-end justify-between gap-4 mb-8 pb-6 border-b border-border">
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] font-medium text-muted-foreground mb-2">
          Codebase health
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight leading-none">
          {activeRepo?.fullName || "Strata"}
        </h1>
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
                  onClick={() => handleRepoChange(r._id)}
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

  // ── States ──
  if (reposLoading || snapLoading) {
    return (
      <div>
        {Header}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          <div className="clay-card p-6 h-56 animate-pulse" />
          <div className="clay-card p-6 h-56 animate-pulse lg:col-span-2" />
        </div>
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div>
        {Header}
        <div className="clay-card p-8 flex flex-col items-center text-center">
          <AlertCircle size={28} className="text-muted-foreground" />
          <h3 className="mt-4 text-[15px] font-semibold">
            No repositories connected
          </h3>
          <p className="mt-2 text-[13px] text-muted-foreground max-w-sm">
            Connect a repository first to see health data.
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

  if (snapError?.response?.status === 404) {
    return (
      <div>
        {Header}
        <EmptyHealth repoName={activeRepo?.fullName} />
      </div>
    );
  }

  if (snapError) {
    return (
      <div>
        {Header}
        <div
          className="clay-card p-5 flex items-start gap-3"
          style={{ borderColor: "rgba(185, 28, 28, 0.3)" }}
        >
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[13px] font-medium text-destructive">
              Failed to load health data
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {snapError?.response?.data?.error ||
                snapError?.message ||
                "Unknown error"}
            </p>
          </div>
          <button onClick={handleRetry} className="clay-btn px-3 py-1.5 text-[12px]">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!snapshot) return null;

  return (
    <div>
      {Header}

      {/* Hero row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <div className="lg:col-span-1">
          <ScoreGauge
            score={Math.round(snapshot.score)}
            computedAt={snapshot.computedAt}
          />
        </div>
        <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <SignalCard signal="coupling"   value={snapshot.signals.coupling}   />
          <SignalCard signal="churnRisk"  value={snapshot.signals.churnRisk}  />
          <SignalCard signal="debt"       value={snapshot.signals.debt}       />
          <SignalCard signal="confidence" value={snapshot.signals.confidence} />
        </div>
      </div>

      {/* Stat strip — each card is clickable to reveal a brief description. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <StatCard
          icon={Activity}
          label="Score"
          value={Math.round(snapshot.score)}
          trend={snapshot.metrics.scoreChange}
          description="The composite health score (0–100). Combines coupling, churn risk, and semantic findings; baselined by confidence. Higher is healthier — lower means more structural risk."
        />
        <StatCard
          icon={FileCode}
          label="Files"
          value={snapshot.totalFiles}
          description="Number of files in the indexed file tree after skip filters (node_modules, lockfiles, binaries excluded). Capped at 3,000 for monorepos."
        />
        <StatCard
          icon={GitBranch}
          label="Definitions"
          value={snapshot.totalDefs}
          description="Total symbol definitions — functions, classes, methods, interfaces — extracted by tree-sitter across all parsed source files."
        />
        <StatCard
          icon={TrendingUp}
          label="Snapshots"
          value={snapshot.metrics.totalSnapshots}
          description="Number of health snapshots recorded for this repo. One snapshot per indexing run; drives the trend chart and the score forecast."
        />
        <StatCard
          icon={Clock}
          label="Days tracked"
          value={snapshot.metrics.daysTracked}
          description="Days elapsed since the first snapshot was recorded. The longer this is, the more meaningful the trend chart becomes."
        />
        <StatCard
          icon={BarChart3}
          label="PRs analyzed"
          value={snapshot.prCount}
          description="Number of merged PRs the history-summarizer agent has analyzed. Requires an AI provider key in Settings — otherwise stays at zero."
        />
      </div>

      {/* Cost banner — only when there's actual usage to show */}
      {costSummary && costSummary.callCount > 0 && (
        <div className="clay-card p-4 mb-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-md border border-border flex items-center justify-center">
              <Coins className="w-4 h-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
                LLM cost · last 30 days
              </p>
              <div className="flex items-baseline gap-3 mt-1">
                <span className="text-[20px] font-semibold tabular-nums leading-none">
                  ${costSummary.totalUsd.toFixed(4)}
                </span>
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {costSummary.callCount} call
                  {costSummary.callCount === 1 ? "" : "s"}
                  {" · "}
                  {(
                    costSummary.totalInputTokens + costSummary.totalOutputTokens
                  ).toLocaleString()}{" "}
                  tokens
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() =>
              navigate(`/dashboard/forensics?repoId=${activeRepoId}`)
            }
            className="clay-btn px-3 py-1.5 text-[12px] flex items-center gap-1.5"
          >
            See sources
            <ArrowUpRight className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Trend — full width so the area chart has room to breathe. Pass
          the earliest tracked event (oldest push or oldest snapshot) as
          the axis start so the timeline reflects the repo's full history
          instead of collapsing to just the snapshot dates. */}
      {history.length > 0 && (
        <div className="mb-3">
          <TrendChart
            data={history}
            rangeStart={(() => {
              const candidates: number[] = [];
              const pushes = snapshot.recentPushes ?? [];
              for (const p of pushes) {
                const t = new Date(p.pushedAt).getTime();
                if (!Number.isNaN(t)) candidates.push(t);
              }
              for (const h of history) {
                const t = new Date(h.computedAt).getTime();
                if (!Number.isNaN(t)) candidates.push(t);
              }
              return candidates.length
                ? new Date(Math.min(...candidates)).toISOString()
                : undefined;
            })()}
            rangeEnd={new Date().toISOString()}
          />
        </div>
      )}

      {/* Recent activity — stacked below the trend */}
      {snapshot.recentPushes && snapshot.recentPushes.length > 0 && (
        <div className="mb-3">
          <CommitTimeline pushes={snapshot.recentPushes} repoId={activeRepoId!} />
        </div>
      )}

      {/* Score breakdown — formula plugged in with current numbers, paired
          with the visual signal breakdown right below it. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <ScoreBreakdown
          score={snapshot.score}
          signals={snapshot.signals}
          smells={snapshot.smells ?? { hitCount: 0, normalized: 0 }}
          computedAt={snapshot.computedAt}
        />
        {history.length > 0 ? (
          <SignalTrendChart data={history} />
        ) : (
          <div className="clay-card p-5">
            <p className="text-[12px] font-medium mb-1">Signal breakdown</p>
            <p className="text-[11px] text-muted-foreground">
              No snapshots yet. Re-index this repo to populate signals.
            </p>
          </div>
        )}
      </div>
      <div className="mb-3">
        {snapshot.recentPushes && snapshot.recentPushes.length > 0 ? (
          <CodebaseGrowthChart pushes={snapshot.recentPushes} />
        ) : (
          <div className="clay-card p-5">
            <p className="text-[12px] font-medium mb-1">Push activity</p>
            <p className="text-[11px] text-muted-foreground">
              No pushes recorded yet for this repo.
            </p>
          </div>
        )}
      </div>

      {snapshot.hotFiles.length > 0 && <HotFileList files={snapshot.hotFiles} />}
    </div>
  );
}
