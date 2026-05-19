import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode,
  GitPullRequest,
  Coins,
  Sparkles,
  History as HistoryIcon,
  BarChart3,
  Activity,
  Clock,
  ArrowUpRight,
  Search,
} from "lucide-react";
import api from "../api/axios";
import { FileSnippet } from "../components/forensics/FileSnippet";

/* ─── Types matching /health/:repoId/evidence ─────────────────── */

interface CouplingTopFile {
  path: string;
  pageRankScore: number;
}

interface HotFile {
  path: string;
  pageRankScore: number;
  pageRankPercentile: number;
  churnPushes: number;
  totalRecentPushes: number;
}

interface ConventionDetail {
  text: string;
  sourceFiles: string[];
  llmUsageId: string | null;
  category: string | null;
}

interface HistoryDetail {
  text: string;
  sourcePRs: number[];
  llmUsageId: string | null;
}

interface LLMUsageRow {
  _id: string;
  runId: string;
  taskType: "pattern_extractor" | "history_summarizer";
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  promptPreview: string;
  inputs: Record<string, any>;
  rawResponse: string;
  createdAt: string;
}

interface Evidence {
  repoId: string;
  repoFullName: string;
  isPublic: boolean;
  indexStatus: string;
  lastIndexedAt: string | null;
  score: number;
  signals: {
    coupling:   { gini: number; normalized: number };
    churnRisk:  { hotFileCount: number; normalized: number };
    debt:       { weightedTotal: number; avgPerPR: number; normalized: number };
    confidence: { rollingAvg: number; normalized: number };
  };
  coupling: {
    gini: number;
    topFiles: CouplingTopFile[];
    totalFiles: number;
  };
  hotFiles: HotFile[];
  conventions: ConventionDetail[];
  history: HistoryDetail[];
  pushStats: {
    count: number;
    oldest: string | null;
    newest: string | null;
  };
  llmUsages: LLMUsageRow[];
  costSummary: {
    totalUsd: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    callCount: number;
  };
}

interface Repo {
  _id: string;
  fullName: string;
}

/**
 * Forensics — the "show me your work" page. Renders every claim on the
 * Health page with its underlying evidence: which files were sampled,
 * the LLM's exact prompt + raw response, per-file PageRank scores,
 * per-file churn rates, and a full per-call cost ledger.
 */
export default function Forensics() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [data, setData] = useState<Evidence | null>(null);
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
      .get(`/health/${activeRepoId}/evidence`)
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
          Forensics
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight leading-none">
          {activeRepo?.fullName || "Sources & citations"}
        </h1>
        <p className="mt-3 text-[13px] text-muted-foreground max-w-2xl leading-relaxed">
          Every claim on the Health page, with its evidence: which files were
          sampled, which PRs were summarized, the exact prompts that produced
          each LLM output, and the per-call cost ledger.
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
        <div className="clay-card p-6 h-40 animate-pulse" />
      </div>
    );
  }

  if (error?.response?.status === 404) {
    return (
      <div>
        {Header}
        <div className="clay-card p-10 flex flex-col items-center text-center">
          <Search className="w-6 h-6 text-muted-foreground" />
          <h3 className="mt-4 text-[15px] font-semibold">No evidence yet</h3>
          <p className="mt-2 text-[13px] text-muted-foreground max-w-sm">
            Strata hasn't indexed this repo yet. Trigger an index from the
            Repos page and forensics will appear here.
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
              Failed to load forensics
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

      {/* Headline strip — score + cost + counts */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        <StatBlock
          icon={Activity}
          label="Score"
          value={Math.round(data.score)}
        />
        <StatBlock
          icon={Coins}
          label="LLM cost (all-time)"
          value={`$${data.costSummary.totalUsd.toFixed(4)}`}
          sub={`${data.costSummary.callCount} call${data.costSummary.callCount === 1 ? "" : "s"}`}
        />
        <StatBlock
          icon={FileCode}
          label="Files in graph"
          value={data.coupling.totalFiles}
        />
        <StatBlock
          icon={Clock}
          label="Pushes tracked"
          value={data.pushStats.count}
        />
      </div>

      {/* ─── Section: Score breakdown ─────────────────────────────── */}
      <Section
        title="How the score was calculated"
        description={`Composite of two structural signals — coupling and churn risk — plus a neutral confidence baseline. Higher signal values reduce the score.`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <SignalBlock
            label="Coupling"
            inputs={`Gini ${data.signals.coupling.gini.toFixed(3)} of PageRank across ${data.coupling.totalFiles} files`}
            normalized={data.signals.coupling.normalized}
            weight={45}
            invert
          />
          <SignalBlock
            label="Churn risk"
            inputs={`${data.signals.churnRisk.hotFileCount} hot file${data.signals.churnRisk.hotFileCount === 1 ? "" : "s"} from ${data.pushStats.count} recent push${data.pushStats.count === 1 ? "" : "es"}`}
            normalized={data.signals.churnRisk.normalized}
            weight={45}
            invert
          />
          <SignalBlock
            label="Findings debt"
            inputs="Reserved — no PR review data in this build"
            normalized={data.signals.debt.normalized}
            weight={0}
            invert
          />
          <SignalBlock
            label="Confidence"
            inputs={`${Math.round(data.signals.confidence.rollingAvg)}/100 baseline (neutral)`}
            normalized={data.signals.confidence.normalized}
            weight={10}
          />
        </div>

        <div className="mt-4 p-3 rounded-md bg-muted/50 border border-border">
          <p className="text-[12px] font-mono text-muted-foreground">
            score = 100 &minus; (coupling × 45) &minus; (churnRisk × 45) + (confidence × 10)
          </p>
          <p className="text-[12px] font-mono text-foreground mt-1">
            = 100 &minus; ({data.signals.coupling.normalized.toFixed(3)} × 45) &minus;{" "}
            ({data.signals.churnRisk.normalized.toFixed(3)} × 45) +{" "}
            ({data.signals.confidence.normalized.toFixed(3)} × 10) ={" "}
            <span className="font-semibold">{Math.round(data.score)}</span>
          </p>
        </div>
      </Section>

      {/* ─── Section: Coupling — top files by PageRank ───────────── */}
      <Section
        title="Coupling — top files by PageRank"
        description={`The dependency graph was built from ${data.coupling.totalFiles} files. These are the files that other files depend on most heavily — the load-bearing parts of the codebase. Concentration of "load" across few files is what drives the Coupling signal up.`}
      >
        <PageRankTable
          repoId={activeRepoId!}
          files={data.coupling.topFiles}
          repoFullName={data.repoFullName}
        />
      </Section>

      {/* ─── Section: Hot files (blast-radius) ───────────────────── */}
      <Section
        title="Blast-radius files"
        description={`Files in the top 10% by PageRank that ALSO appear in more than 30% of recent pushes. Changes to these files ripple through the codebase. Strata uses these counts directly to compute the Churn risk signal.`}
      >
        {data.hotFiles.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            None detected. Either the codebase doesn't have load-bearing files
            that churn frequently, or there aren't enough pushes tracked yet
            to compute churn (need at least a handful).
          </p>
        ) : (
          <HotFilesTable
            repoId={activeRepoId!}
            files={data.hotFiles}
            repoFullName={data.repoFullName}
          />
        )}
      </Section>

      {/* ─── Section: Conventions w/ source files + LLM prompt ───── */}
      <Section
        title="Coding conventions"
        description={
          data.conventions.length === 0
            ? "No conventions extracted. The pattern agent runs only when you have an AI provider configured in Settings."
            : `Extracted by the pattern agent from a sample of representative source files. Each convention links to the prompt that was sent to the LLM and the files the LLM saw.`
        }
      >
        {data.conventions.length > 0 && (
          <div className="space-y-3">
            {data.conventions.map((c, i) => {
              const usage = data.llmUsages.find(
                (u) => u._id === c.llmUsageId,
              );
              return (
                <ConventionCard
                  key={i}
                  convention={c}
                  usage={usage}
                  repoId={activeRepoId!}
                />
              );
            })}
          </div>
        )}
      </Section>

      {/* ─── Section: PR history themes ───────────────────────────── */}
      <Section
        title="Recent themes (from merged PRs)"
        description={
          data.history.length === 0
            ? "No themes extracted yet."
            : `The history agent saw the merged PRs listed below and produced these themes. Each theme cites the full PR set the LLM was shown.`
        }
      >
        {data.history.length > 0 && (
          <HistoryThemes
            history={data.history}
            usages={data.llmUsages}
            repoFullName={data.repoFullName}
          />
        )}
      </Section>

      {/* ─── Section: Full cost ledger ────────────────────────────── */}
      <Section
        title="LLM cost ledger"
        description={
          data.llmUsages.length === 0
            ? "No LLM calls have been made for this repo yet."
            : `Every LLM call recorded for this repo, newest first. Click to inspect the prompt, the raw response, and the input the agent supplied.`
        }
      >
        {data.llmUsages.length > 0 && <CostLedger usages={data.llmUsages} />}
      </Section>
    </div>
  );
}

/* ─── Building blocks ──────────────────────────────────────────── */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-10">
      <div className="mb-4 pb-3 border-b border-border">
        <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
        <p className="text-[12.5px] text-muted-foreground mt-1 leading-relaxed max-w-3xl">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

function StatBlock({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="clay-card p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
          {label}
        </span>
      </div>
      <p className="text-[22px] font-semibold tracking-tight tabular-nums leading-none">
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-muted-foreground mt-1.5">{sub}</p>
      )}
    </div>
  );
}

function SignalBlock({
  label,
  inputs,
  normalized,
  weight,
  invert,
}: {
  label: string;
  inputs: string;
  normalized: number;
  weight: number;
  invert?: boolean;
}) {
  const pct = Math.round(normalized * 100);
  const contribution = invert
    ? -(normalized * weight)
    : normalized * weight;
  return (
    <div className="border border-border rounded-md p-3">
      <p className="text-[12px] font-medium">{label}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
        {inputs}
      </p>
      <div className="flex items-baseline justify-between mt-3">
        <span className="text-[18px] font-mono font-medium tabular-nums leading-none">
          {pct}
          <span className="text-[12px] text-muted-foreground font-mono ml-0.5">
            %
          </span>
        </span>
        <span
          className="text-[11px] font-mono tabular-nums"
          style={{
            color:
              contribution < 0
                ? "var(--destructive)"
                : contribution > 0
                  ? "var(--chart-5)"
                  : "var(--muted-foreground)",
          }}
        >
          {contribution >= 0 ? "+" : ""}
          {contribution.toFixed(1)}
        </span>
      </div>
      <p className="text-[10.5px] text-muted-foreground mt-1">
        weight: {weight}
      </p>
    </div>
  );
}

/** Top-N PageRank leaderboard, with collapsible inline file previews. */
function PageRankTable({
  repoId,
  files,
  repoFullName,
}: {
  repoId: string;
  files: CouplingTopFile[];
  repoFullName: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const maxScore = files[0]?.pageRankScore || 1;

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="grid grid-cols-[2.5rem_1fr_5rem_5rem_2rem] gap-3 px-3 py-2 text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground bg-muted/40 border-b border-border">
        <span className="text-right">#</span>
        <span>File</span>
        <span className="text-right">PageRank</span>
        <span>Relative</span>
        <span></span>
      </div>
      <ol>
        {files.map((f, i) => {
          const isOpen = expanded === f.path;
          const bar = (f.pageRankScore / maxScore) * 100;
          return (
            <li key={f.path} className="border-b border-border last:border-b-0">
              <button
                onClick={() => setExpanded(isOpen ? null : f.path)}
                className="w-full grid grid-cols-[2.5rem_1fr_5rem_5rem_2rem] gap-3 items-center px-3 py-2 text-left hover:bg-muted/40 transition-colors"
              >
                <span className="text-right text-[11px] text-muted-foreground font-mono tabular-nums">
                  {i + 1}
                </span>
                <span className="text-[12px] font-mono truncate">{f.path}</span>
                <span className="text-right text-[11px] font-mono tabular-nums">
                  {f.pageRankScore.toExponential(2)}
                </span>
                <span className="h-1.5 bg-border rounded-full overflow-hidden">
                  <span
                    className="block h-full rounded-full bg-foreground"
                    style={{ width: `${bar}%` }}
                  />
                </span>
                <ChevronRight
                  className={`w-3 h-3 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                />
              </button>
              {isOpen && (
                <div className="px-3 pb-3">
                  <FileSnippet repoId={repoId} path={f.path} defaultExpanded />
                  <a
                    href={`https://github.com/${repoFullName}/blob/HEAD/${f.path}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    Open in GitHub
                  </a>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function HotFilesTable({
  repoId,
  files,
  repoFullName,
}: {
  repoId: string;
  files: HotFile[];
  repoFullName: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="grid grid-cols-[1fr_5rem_6rem_2rem] gap-3 px-3 py-2 text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground bg-muted/40 border-b border-border">
        <span>File</span>
        <span className="text-right">PageRank %ile</span>
        <span className="text-right">Churn</span>
        <span></span>
      </div>
      {files.map((f) => {
        const isOpen = expanded === f.path;
        const churnPct =
          f.totalRecentPushes > 0
            ? Math.round((f.churnPushes / f.totalRecentPushes) * 100)
            : 0;
        return (
          <div key={f.path} className="border-b border-border last:border-b-0">
            <button
              onClick={() => setExpanded(isOpen ? null : f.path)}
              className="w-full grid grid-cols-[1fr_5rem_6rem_2rem] gap-3 items-center px-3 py-2 text-left hover:bg-muted/40 transition-colors"
            >
              <span className="text-[12px] font-mono truncate">{f.path}</span>
              <span className="text-right text-[11px] font-mono tabular-nums">
                top {100 - f.pageRankPercentile}%
              </span>
              <span className="text-right text-[11px] font-mono tabular-nums">
                {f.churnPushes}/{f.totalRecentPushes}{" "}
                <span className="text-muted-foreground">({churnPct}%)</span>
              </span>
              <ChevronRight
                className={`w-3 h-3 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
              />
            </button>
            {isOpen && (
              <div className="px-3 pb-3">
                <FileSnippet repoId={repoId} path={f.path} defaultExpanded />
                <a
                  href={`https://github.com/${repoFullName}/commits/HEAD/${f.path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="w-2.5 h-2.5" />
                  View commit history on GitHub
                </a>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ConventionCard({
  convention,
  usage,
  repoId,
}: {
  convention: ConventionDetail;
  usage?: LLMUsageRow;
  repoId: string;
}) {
  const [showSources, setShowSources] = useState(false);
  const [showLLM, setShowLLM] = useState(false);

  return (
    <div className="clay-card p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1">
          {convention.category && (
            <span className="inline-block text-[10px] uppercase tracking-[0.06em] font-medium text-muted-foreground mb-1.5">
              {convention.category.replace(/-/g, " ")}
            </span>
          )}
          <p className="text-[13px] leading-snug">{convention.text}</p>
        </div>
        {usage && (
          <div className="text-right shrink-0">
            <p className="text-[11px] font-mono tabular-nums">
              ${usage.costUsd.toFixed(5)}
            </p>
            <p className="text-[10px] text-muted-foreground">{usage.model}</p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        {convention.sourceFiles.length > 0 && (
          <button
            onClick={() => setShowSources(!showSources)}
            className="flex items-center gap-1 hover:text-foreground"
          >
            {showSources ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <FileCode className="w-3 h-3" />
            {convention.sourceFiles.length} source file
            {convention.sourceFiles.length === 1 ? "" : "s"}
          </button>
        )}
        {usage && (
          <button
            onClick={() => setShowLLM(!showLLM)}
            className="flex items-center gap-1 hover:text-foreground"
          >
            {showLLM ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Sparkles className="w-3 h-3" />
            LLM prompt & response
          </button>
        )}
      </div>

      {showSources && convention.sourceFiles.length > 0 && (
        <div className="mt-3 space-y-2">
          {convention.sourceFiles.map((path) => (
            <FileSnippet key={path} repoId={repoId} path={path} />
          ))}
        </div>
      )}

      {showLLM && usage && (
        <div className="mt-3 space-y-2">
          <PromptResponseBlock usage={usage} />
        </div>
      )}
    </div>
  );
}

function HistoryThemes({
  history,
  usages,
  repoFullName,
}: {
  history: HistoryDetail[];
  usages: LLMUsageRow[];
  repoFullName: string;
}) {
  // All summaries share the same usage row (single LLM call), so render
  // the PR list once at the top, then the themes, then prompt/response.
  const usage = history[0]?.llmUsageId
    ? usages.find((u) => u._id === history[0].llmUsageId)
    : undefined;
  const sourcePRs = history[0]?.sourcePRs || [];
  const [showLLM, setShowLLM] = useState(false);

  return (
    <div className="space-y-4">
      {/* Theme list */}
      <ul className="space-y-2">
        {history.map((h, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-[13px] leading-snug"
          >
            <ArrowUpRight className="w-3 h-3 text-muted-foreground shrink-0 mt-1" />
            <span>{h.text}</span>
          </li>
        ))}
      </ul>

      {/* Source PRs */}
      {sourcePRs.length > 0 && (
        <div className="border border-border rounded-md p-4">
          <p className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground mb-2">
            Source PRs ({sourcePRs.length})
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sourcePRs.map((n) => (
              <a
                key={n}
                href={`https://github.com/${repoFullName}/pull/${n}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border text-[11px] font-mono text-foreground hover:bg-muted transition-colors"
              >
                <GitPullRequest className="w-2.5 h-2.5" />
                #{n}
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Prompt + response */}
      {usage && (
        <>
          <button
            onClick={() => setShowLLM(!showLLM)}
            className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground"
          >
            {showLLM ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <Sparkles className="w-3 h-3" />
            LLM prompt & response · ${usage.costUsd.toFixed(5)} · {usage.model}
          </button>
          {showLLM && <PromptResponseBlock usage={usage} />}
        </>
      )}
    </div>
  );
}

function PromptResponseBlock({ usage }: { usage: LLMUsageRow }) {
  return (
    <div className="space-y-3">
      <div className="border border-border rounded-md overflow-hidden">
        <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
          <p className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
            Prompt (first 200 chars)
          </p>
          <p className="text-[10.5px] text-muted-foreground font-mono tabular-nums">
            {usage.inputTokens.toLocaleString()} input tokens
          </p>
        </div>
        <pre className="p-3 text-[11.5px] font-mono whitespace-pre-wrap leading-relaxed text-muted-foreground">
          {usage.promptPreview || "(no preview recorded)"}
        </pre>
      </div>
      <div className="border border-border rounded-md overflow-hidden">
        <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between">
          <p className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
            Raw response
          </p>
          <p className="text-[10.5px] text-muted-foreground font-mono tabular-nums">
            {usage.outputTokens.toLocaleString()} output tokens · {usage.durationMs}ms
          </p>
        </div>
        <pre className="p-3 text-[11.5px] font-mono whitespace-pre-wrap leading-relaxed max-h-72 overflow-y-auto">
          {usage.rawResponse || "(no response recorded)"}
        </pre>
      </div>
    </div>
  );
}

function CostLedger({ usages }: { usages: LLMUsageRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Group by runId so users see "one index run = these calls"
  const runs = new Map<string, LLMUsageRow[]>();
  for (const u of usages) {
    if (!runs.has(u.runId)) runs.set(u.runId, []);
    runs.get(u.runId)!.push(u);
  }

  return (
    <div className="space-y-4">
      {[...runs.entries()].map(([runId, rows]) => {
        const totalCost = rows.reduce((s, r) => s + r.costUsd, 0);
        const totalIn = rows.reduce((s, r) => s + r.inputTokens, 0);
        const totalOut = rows.reduce((s, r) => s + r.outputTokens, 0);
        const ts = rows[0].createdAt;
        return (
          <div key={runId} className="border border-border rounded-md overflow-hidden">
            <div className="px-3 py-2 bg-muted/40 border-b border-border flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
                  Index run
                </p>
                <p className="text-[11.5px] font-mono text-foreground">
                  {runId.slice(0, 24)}…
                </p>
              </div>
              <div className="text-right">
                <p className="text-[14px] font-mono font-semibold tabular-nums">
                  ${totalCost.toFixed(5)}
                </p>
                <p className="text-[10.5px] text-muted-foreground tabular-nums">
                  {totalIn.toLocaleString()} + {totalOut.toLocaleString()} tokens ·{" "}
                  {new Date(ts).toLocaleString()}
                </p>
              </div>
            </div>
            <div>
              {rows.map((r) => {
                const isOpen = expanded === r._id;
                return (
                  <div key={r._id} className="border-b border-border last:border-b-0">
                    <button
                      onClick={() => setExpanded(isOpen ? null : r._id)}
                      className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        {r.taskType === "pattern_extractor" ? (
                          <BarChart3 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <HistoryIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        )}
                        <div>
                          <p className="text-[12px] font-medium">
                            {r.taskType === "pattern_extractor"
                              ? "Pattern extractor"
                              : "History summarizer"}
                          </p>
                          <p className="text-[10.5px] text-muted-foreground">
                            {r.provider} · {r.model}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 text-[11px] tabular-nums shrink-0">
                        <span className="text-muted-foreground">
                          {r.inputTokens.toLocaleString()}↑ {r.outputTokens.toLocaleString()}↓
                        </span>
                        <span className="font-mono font-medium">
                          ${r.costUsd.toFixed(5)}
                        </span>
                        <ChevronRight
                          className={`w-3 h-3 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                        />
                      </div>
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3">
                        <PromptResponseBlock usage={r} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
