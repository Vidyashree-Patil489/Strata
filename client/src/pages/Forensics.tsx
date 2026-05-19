import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  AlertCircle,
  AlertTriangle,
  Bot,
  CheckCircle,
  Info,
  Loader2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileCode,
  GitBranch,
  GitCommit,
  GitPullRequest,
  Coins,
  Lock,
  Sparkles,
  History as HistoryIcon,
  BarChart3,
  Activity,
  Clock,
  ArrowUpRight,
  Search,
  Users,
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

type SmellKind = "god-file" | "dead-file" | "deep-coupling" | "circular-dep";
type SmellSeverity = "warning" | "critical";

interface SmellDetail {
  path: string;
  kind: SmellKind;
  severity: SmellSeverity;
  metric: number;
  evidence: string;
}

type BranchStatus =
  | "default"
  | "active"
  | "idle"
  | "stale"
  | "abandoned"
  | "unknown";
type BranchSeverity = "info" | "good" | "warning" | "critical";

interface BranchDetail {
  name: string;
  status: BranchStatus;
  severity: BranchSeverity;
  lastCommitSha: string;
  lastCommitAt: string | null;
  lastCommitAuthor: string | null;
  daysSinceLastCommit: number | null;
  isDefault: boolean;
  isProtected: boolean;
  hasOpenPR: boolean;
  openPRNumber: number | null;
  evidence: string;
}

type ContributorStatus =
  | "active"
  | "recent"
  | "dormant"
  | "former"
  | "bot"
  | "unknown";
type ContributorSeverity = "info" | "good" | "warning" | "critical";

interface ContributorDetail {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  contributions: number;
  contributionPct: number;
  recentCommits: number;
  lastCommitAt: string | null;
  daysSinceLastCommit: number | null;
  status: ContributorStatus;
  severity: ContributorSeverity;
  isBot: boolean;
  evidence: string;
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
  /** "exact" — direct match. "normalized" — matched after suffix stripping.
   *  "unknown" — no pricing entry; recorded cost is $0 but unreliable. */
  pricingMatch?: "exact" | "normalized" | "unknown";
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
  smells: { hitCount: number; normalized: number };
  smellsDetailed: SmellDetail[];
  branches: {
    total: number;
    active: number;
    idle: number;
    stale: number;
    abandoned: number;
    fetchedAt: string | null;
  };
  branchesDetailed: BranchDetail[];
  contributors: {
    total: number;
    activeCount: number;
    botCount: number;
    busFactor: number;
    recentWindow: number;
    totalCommits: number;
    fetchedAt: string | null;
  };
  contributorsDetailed: ContributorDetail[];
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
          description="The composite health score (0–100). Combines coupling, churn risk, and semantic findings; baselined by confidence. Same number you see on the Health page."
        />
        <StatBlock
          icon={Coins}
          label="LLM cost (all-time)"
          value={`$${data.costSummary.totalUsd.toFixed(4)}`}
          sub={`${data.costSummary.callCount} call${data.costSummary.callCount === 1 ? "" : "s"}`}
          description="Total USD cost of all LLM calls for this repo since indexing began — sum of pattern-extractor and history-summarizer runs. Per-call breakdown is in the cost ledger below."
        />
        <StatBlock
          icon={FileCode}
          label="Files in graph"
          value={data.coupling.totalFiles}
          description="Number of files that participate in the dependency graph — i.e. tree-sitter found at least one symbol in them and they contributed to PageRank."
        />
        <StatBlock
          icon={Clock}
          label="Pushes tracked"
          value={data.pushStats.count}
          description="Total push events recorded for this repo. Each comes from the GitHub webhook (or a manual re-index) and feeds the churn-risk signal."
        />
      </div>

      {/* ─── Section: Score breakdown ─────────────────────────────── */}
      <Section
        title="How the score was calculated"
        description={`Composite of three structural signals — coupling, churn risk, and semantic findings — plus a neutral confidence baseline. Higher signal values reduce the score.`}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <SignalBlock
            label="Coupling"
            inputs={`Gini ${data.signals.coupling.gini.toFixed(3)} of PageRank across ${data.coupling.totalFiles} files`}
            normalized={data.signals.coupling.normalized}
            weight={35}
            invert
          />
          <SignalBlock
            label="Churn risk"
            inputs={`${data.signals.churnRisk.hotFileCount} hot file${data.signals.churnRisk.hotFileCount === 1 ? "" : "s"} from ${data.pushStats.count} recent push${data.pushStats.count === 1 ? "" : "es"}`}
            normalized={data.signals.churnRisk.normalized}
            weight={35}
            invert
          />
          <SignalBlock
            label="Semantic findings"
            inputs={`${data.smells?.hitCount ?? 0} anti-pattern${(data.smells?.hitCount ?? 0) === 1 ? "" : "s"} from dependency graph`}
            normalized={data.smells?.normalized ?? 0}
            weight={20}
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
            score = 100 &minus; (coupling × 35) &minus; (churnRisk × 35) &minus; (smells × 20) + (confidence × 10)
          </p>
          <p className="text-[12px] font-mono text-foreground mt-1">
            = 100 &minus; ({data.signals.coupling.normalized.toFixed(3)} × 35) &minus;{" "}
            ({data.signals.churnRisk.normalized.toFixed(3)} × 35) &minus;{" "}
            ({(data.smells?.normalized ?? 0).toFixed(3)} × 20) +{" "}
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

      {/* ─── Section: Semantic analysis (structural anti-patterns) ─ */}
      <Section
        title="Semantic analysis"
        description="Structural analysis of the dependency graph — flags god files, dead files, deep coupling, and direct circular dependencies. Derived purely from definitions + import edges."
      >
        <SmellsList
          repoId={activeRepoId!}
          smells={data.smellsDetailed}
          repoFullName={data.repoFullName}
        />
      </Section>

      {/* ─── Section: Branch analysis (GitHub branches hygiene) ───── */}
      <Section
        title="Branch analysis"
        description="Snapshot of every branch fetched at index time — last commit, author, open-PR overlap, and a hygiene classification (active / idle / stale / abandoned)."
      >
        <BranchAnalysisList
          branches={data.branchesDetailed}
          summary={data.branches}
          repoFullName={data.repoFullName}
        />
      </Section>

      {/* ─── Section: Contributors (lifetime + recent activity) ───── */}
      <Section
        title="Contributors"
        description="Top 50 contributors by lifetime commit count, with recent activity status and a bus-factor estimate (how many authors cover 50% of all commits)."
      >
        <ContributorList
          contributors={data.contributorsDetailed}
          summary={data.contributors}
        />
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
  description,
}: {
  icon: any;
  label: string;
  value: string | number;
  sub?: string;
  /** Optional one-line explanation revealed on click. */
  description?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const interactive = !!description;

  const body = (
    <>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3 text-muted-foreground" />
        <span className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground">
          {label}
        </span>
        {interactive && (
          <Info
            className={`w-2.5 h-2.5 ml-auto text-muted-foreground transition-opacity ${expanded ? "opacity-100" : "opacity-50"}`}
            aria-hidden="true"
          />
        )}
      </div>
      <p className="text-[22px] font-semibold tracking-tight tabular-nums leading-none">
        {value}
      </p>
      {sub && (
        <p className="text-[11px] text-muted-foreground mt-1.5">{sub}</p>
      )}
      {interactive && expanded && (
        <p className="text-[11px] text-muted-foreground mt-2.5 leading-relaxed">
          {description}
        </p>
      )}
    </>
  );

  if (!interactive) {
    return <div className="clay-card p-4">{body}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      aria-expanded={expanded}
      aria-label={`${label}: ${value}. ${expanded ? "Hide" : "Show"} explanation.`}
      className="clay-card p-4 text-left w-full cursor-pointer hover:bg-muted/30 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {body}
    </button>
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

const SMELL_GROUP_ORDER: SmellKind[] = [
  "circular-dep",
  "god-file",
  "deep-coupling",
  "dead-file",
];

const SMELL_GROUP_LABEL: Record<SmellKind, string> = {
  "circular-dep": "Circular Dependencies",
  "god-file":     "God Files",
  "deep-coupling":"Deep Coupling",
  "dead-file":    "Dead Files",
};

// Subheader badge background per kind. Border + dark text are inherited
// so the badge reads as an accent, not a solid block.
const SMELL_GROUP_BADGE: Record<
  SmellKind,
  { bg: string; fg: string; border: string }
> = {
  "circular-dep":  { bg: "rgba(185, 28, 28, 0.10)",  fg: "#991b1b", border: "rgba(185, 28, 28, 0.30)" },
  "god-file":      { bg: "rgba(234, 88, 12, 0.10)",  fg: "#9a3412", border: "rgba(234, 88, 12, 0.30)" },
  "deep-coupling": { bg: "rgba(202, 138, 4, 0.10)",  fg: "#854d0e", border: "rgba(202, 138, 4, 0.30)" },
  "dead-file":     { bg: "rgba(120, 113, 108, 0.10)", fg: "#57534e", border: "rgba(120, 113, 108, 0.30)" },
};

function smellMetricLabel(s: SmellDetail): string {
  switch (s.kind) {
    case "god-file":      return `${s.metric} defs`;
    case "deep-coupling": return `${s.metric} deps`;
    case "circular-dep":  return `${s.metric} cycle${s.metric === 1 ? "" : "s"}`;
    case "dead-file":     return `0 refs`;
  }
}

function SmellsList({
  repoId,
  smells,
  repoFullName,
}: {
  repoId: string;
  smells: SmellDetail[];
  repoFullName: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!smells || smells.length === 0) {
    return (
      <div className="border border-border rounded-md p-6 flex items-start gap-3">
        <CheckCircle
          className="w-4 h-4 shrink-0 mt-0.5"
          style={{ color: "var(--chart-5)" }}
        />
        <div>
          <p className="text-[13px] font-medium">
            No smells detected — clean architecture
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
            No god files, dead files, deep-coupling files, or direct cycles
            were found in the dependency graph.
          </p>
        </div>
      </div>
    );
  }

  const grouped = SMELL_GROUP_ORDER.map((kind) => ({
    kind,
    items: smells.filter((s) => s.kind === kind),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      {grouped.map(({ kind, items }) => {
        const badge = SMELL_GROUP_BADGE[kind];
        return (
          <div key={kind}>
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-3.5 h-3.5 text-muted-foreground" />
              <h3 className="text-[12.5px] font-semibold tracking-tight">
                {SMELL_GROUP_LABEL[kind]}
              </h3>
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium tabular-nums"
                style={{
                  background: badge.bg,
                  color: badge.fg,
                  border: `1px solid ${badge.border}`,
                }}
              >
                {items.length}
              </span>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <div className="grid grid-cols-[1.25rem_1fr_6rem_2rem] gap-3 px-3 py-2 text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground bg-muted/40 border-b border-border">
                <span></span>
                <span>File &amp; evidence</span>
                <span className="text-right">Metric</span>
                <span></span>
              </div>
              {items.map((s) => {
                const rowKey = `${s.kind}::${s.path}`;
                const isOpen = expanded === rowKey;
                const dotColor =
                  s.severity === "critical" ? "#b91c1c" : "#ca8a04";
                return (
                  <div
                    key={rowKey}
                    className="border-b border-border last:border-b-0"
                  >
                    <button
                      onClick={() => setExpanded(isOpen ? null : rowKey)}
                      className="w-full grid grid-cols-[1.25rem_1fr_6rem_2rem] gap-3 items-center px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                    >
                      <span
                        className="w-2 h-2 rounded-full justify-self-center"
                        style={{ background: dotColor }}
                        title={s.severity}
                      />
                      <span className="min-w-0">
                        <span
                          className="block text-[12px] font-mono truncate"
                          title={s.path}
                        >
                          {s.path}
                        </span>
                        <span className="block text-[11px] text-muted-foreground truncate mt-0.5">
                          {s.evidence}
                        </span>
                      </span>
                      <span className="text-right">
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded border text-[10.5px] font-mono tabular-nums"
                          style={{
                            background: badge.bg,
                            color: badge.fg,
                            borderColor: badge.border,
                          }}
                        >
                          {smellMetricLabel(s)}
                        </span>
                      </span>
                      <ChevronRight
                        className={`w-3 h-3 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`}
                      />
                    </button>
                    {isOpen && (
                      <div className="px-3 pb-3">
                        <FileSnippet
                          repoId={repoId}
                          path={s.path}
                          defaultExpanded
                        />
                        <a
                          href={`https://github.com/${repoFullName}/blob/HEAD/${s.path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          Open in GitHub
                        </a>
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

const BRANCH_GROUP_ORDER: BranchStatus[] = [
  "default",
  "active",
  "idle",
  "stale",
  "abandoned",
  "unknown",
];

const BRANCH_GROUP_LABEL: Record<BranchStatus, string> = {
  default:   "Default Branch",
  active:    "Active",
  idle:      "Idle",
  stale:     "Stale",
  abandoned: "Abandoned",
  unknown:   "Unknown",
};

const BRANCH_GROUP_BADGE: Record<
  BranchStatus,
  { bg: string; fg: string; border: string }
> = {
  default:   { bg: "rgba(79, 70, 229, 0.08)",   fg: "#3730a3", border: "rgba(79, 70, 229, 0.30)" },
  active:    { bg: "rgba(21, 128, 61, 0.08)",   fg: "#15803d", border: "rgba(21, 128, 61, 0.30)" },
  idle:      { bg: "rgba(120, 113, 108, 0.10)", fg: "#57534e", border: "rgba(120, 113, 108, 0.30)" },
  stale:     { bg: "rgba(202, 138, 4, 0.10)",   fg: "#854d0e", border: "rgba(202, 138, 4, 0.30)" },
  abandoned: { bg: "rgba(185, 28, 28, 0.10)",   fg: "#991b1b", border: "rgba(185, 28, 28, 0.30)" },
  unknown:   { bg: "rgba(120, 113, 108, 0.06)", fg: "#78716c", border: "rgba(120, 113, 108, 0.20)" },
};

function formatBranchMetric(b: BranchDetail): string {
  if (b.daysSinceLastCommit === null) return "—";
  if (b.daysSinceLastCommit === 0) return "today";
  if (b.daysSinceLastCommit === 1) return "1 day";
  return `${b.daysSinceLastCommit} days`;
}

function BranchAnalysisList({
  branches,
  summary,
  repoFullName,
}: {
  branches: BranchDetail[];
  summary: Evidence["branches"];
  repoFullName: string;
}) {
  if (!branches || branches.length === 0) {
    return (
      <div className="border border-border rounded-md p-6 flex items-start gap-3">
        <GitBranch className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div>
          <p className="text-[13px] font-medium">
            No branch snapshot available
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
            Branch data is fetched from GitHub during indexing. Either this
            repo hasn't been indexed since the feature shipped, or the
            GitHub fetch failed (rate limits, missing permissions). Re-index
            from the Repos page to populate this section.
          </p>
        </div>
      </div>
    );
  }

  const grouped = BRANCH_GROUP_ORDER.map((status) => ({
    status,
    items: branches.filter((b) => b.status === status),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <BranchStat label="Total" value={summary.total} />
        <BranchStat
          label="Active"
          value={summary.active}
          color={summary.active > 0 ? "#15803d" : undefined}
        />
        <BranchStat label="Idle" value={summary.idle} />
        <BranchStat
          label="Stale"
          value={summary.stale}
          color={summary.stale > 0 ? "#a16207" : undefined}
        />
        <BranchStat
          label="Abandoned"
          value={summary.abandoned}
          color={summary.abandoned > 0 ? "#b91c1c" : undefined}
        />
      </div>

      {/* Per-status groups */}
      {grouped.map(({ status, items }) => {
        const badge = BRANCH_GROUP_BADGE[status];
        return (
          <div key={status}>
            <div className="flex items-center gap-2 mb-2">
              <GitBranch className="w-3.5 h-3.5 text-muted-foreground" />
              <h3 className="text-[12.5px] font-semibold tracking-tight">
                {BRANCH_GROUP_LABEL[status]}
              </h3>
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-medium tabular-nums"
                style={{
                  background: badge.bg,
                  color: badge.fg,
                  border: `1px solid ${badge.border}`,
                }}
              >
                {items.length}
              </span>
            </div>
            <div className="border border-border rounded-md overflow-hidden">
              <div className="grid grid-cols-[1.25rem_1fr_6rem_6rem_2rem] gap-3 px-3 py-2 text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground bg-muted/40 border-b border-border">
                <span></span>
                <span>Branch &amp; evidence</span>
                <span className="text-right">Last commit</span>
                <span className="text-right">Signals</span>
                <span></span>
              </div>
              {items.map((b) => {
                const dotColor =
                  b.severity === "critical"
                    ? "#b91c1c"
                    : b.severity === "warning"
                      ? "#ca8a04"
                      : b.severity === "good"
                        ? "#15803d"
                        : "#a8a29e";
                return (
                  <div
                    key={b.name}
                    className="border-b border-border last:border-b-0"
                  >
                    <a
                      href={`https://github.com/${repoFullName}/tree/${encodeURIComponent(b.name)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="grid grid-cols-[1.25rem_1fr_6rem_6rem_2rem] gap-3 items-center px-3 py-2 hover:bg-muted/40 transition-colors"
                    >
                      <span
                        className="w-2 h-2 rounded-full justify-self-center"
                        style={{ background: dotColor }}
                        title={b.severity}
                      />
                      <span className="min-w-0">
                        <span
                          className="block text-[12px] font-mono truncate text-foreground"
                          title={b.name}
                        >
                          {b.name}
                        </span>
                        <span className="block text-[11px] text-muted-foreground truncate mt-0.5">
                          {b.evidence}
                        </span>
                      </span>
                      <span className="text-right text-[11px] font-mono tabular-nums text-muted-foreground">
                        {formatBranchMetric(b)}
                      </span>
                      <span className="flex items-center justify-end gap-1.5">
                        {b.isProtected && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[10px] font-medium"
                            style={{
                              background: "rgba(79, 70, 229, 0.06)",
                              color: "#3730a3",
                              borderColor: "rgba(79, 70, 229, 0.25)",
                            }}
                            title="Protected branch"
                          >
                            <Lock className="w-2.5 h-2.5" />
                          </span>
                        )}
                        {b.hasOpenPR && b.openPRNumber !== null && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[10px] font-mono tabular-nums"
                            style={{
                              background: "rgba(21, 128, 61, 0.06)",
                              color: "#15803d",
                              borderColor: "rgba(21, 128, 61, 0.25)",
                            }}
                            title={`Open PR #${b.openPRNumber}`}
                          >
                            <GitPullRequest className="w-2.5 h-2.5" />#
                            {b.openPRNumber}
                          </span>
                        )}
                      </span>
                      <ExternalLink className="w-3 h-3 text-muted-foreground" />
                    </a>
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

function BranchStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="border border-border rounded-md p-2.5">
      <p className="text-[9.5px] uppercase tracking-wider font-medium text-muted-foreground">
        {label}
      </p>
      <p
        className="text-[16px] font-semibold tabular-nums leading-none mt-0.5"
        style={{ color: color ?? "inherit" }}
      >
        {value}
      </p>
    </div>
  );
}

const CONTRIBUTOR_STATUS_META: Record<
  ContributorStatus,
  { label: string; dot: string; bg: string; fg: string; border: string }
> = {
  active:  { label: "Active",   dot: "#15803d", bg: "rgba(21, 128, 61, 0.08)",   fg: "#15803d", border: "rgba(21, 128, 61, 0.30)" },
  recent:  { label: "Recent",   dot: "#65a30d", bg: "rgba(101, 163, 13, 0.08)",  fg: "#3f6212", border: "rgba(101, 163, 13, 0.30)" },
  dormant: { label: "Dormant",  dot: "#ca8a04", bg: "rgba(202, 138, 4, 0.10)",   fg: "#854d0e", border: "rgba(202, 138, 4, 0.30)" },
  former:  { label: "Former",   dot: "#a8a29e", bg: "rgba(120, 113, 108, 0.08)", fg: "#57534e", border: "rgba(120, 113, 108, 0.25)" },
  bot:     { label: "Bot",      dot: "#6366f1", bg: "rgba(99, 102, 241, 0.08)",  fg: "#4338ca", border: "rgba(99, 102, 241, 0.25)" },
  unknown: { label: "Unknown",  dot: "#a8a29e", bg: "rgba(120, 113, 108, 0.06)", fg: "#78716c", border: "rgba(120, 113, 108, 0.20)" },
};

function ContributorList({
  contributors,
  summary,
}: {
  contributors: ContributorDetail[];
  summary: Evidence["contributors"];
}) {
  if (!contributors || contributors.length === 0) {
    return (
      <div className="border border-border rounded-md p-6 flex items-start gap-3">
        <Users className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
        <div>
          <p className="text-[13px] font-medium">
            No contributor snapshot available
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground leading-relaxed">
            Contributor data is fetched from GitHub during indexing. Either
            this repo hasn't been indexed since the feature shipped, or the
            GitHub fetch failed. Re-index from the Repos page to populate
            this section.
          </p>
        </div>
      </div>
    );
  }

  // Max contributions value used to normalise the bar widths.
  const maxContribs = Math.max(1, ...contributors.map((c) => c.contributions));

  // Bus-factor severity badge.
  const bf = summary.busFactor;
  const bfSeverity =
    bf === 0
      ? { fg: "#78716c", bg: "rgba(120,113,108,0.10)", border: "rgba(120,113,108,0.25)", note: "no data" }
      : bf === 1
        ? { fg: "#991b1b", bg: "rgba(185,28,28,0.10)", border: "rgba(185,28,28,0.30)", note: "single author dominates" }
        : bf === 2
          ? { fg: "#854d0e", bg: "rgba(202,138,4,0.10)", border: "rgba(202,138,4,0.30)", note: "two-author concentration" }
          : { fg: "#15803d", bg: "rgba(21,128,61,0.08)", border: "rgba(21,128,61,0.30)", note: "well-distributed" };

  return (
    <div className="space-y-5">
      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <ContributorStat label="Total" value={summary.total} icon={Users} />
        <ContributorStat
          label="Active"
          value={summary.activeCount}
          color={summary.activeCount > 0 ? "#15803d" : undefined}
          icon={Activity}
        />
        <ContributorStat
          label="Bots"
          value={summary.botCount}
          color={summary.botCount > 0 ? "#4338ca" : undefined}
          icon={Bot}
        />
        <ContributorStat
          label="Commits scanned"
          value={summary.recentWindow}
          icon={GitCommit}
        />
        <div
          className="border rounded-md p-2.5 flex flex-col"
          style={{ background: bfSeverity.bg, borderColor: bfSeverity.border }}
        >
          <p className="text-[9.5px] uppercase tracking-wider font-medium text-muted-foreground flex items-center gap-1">
            <Users className="w-2.5 h-2.5" />
            Bus factor
          </p>
          <p
            className="text-[16px] font-semibold tabular-nums leading-none mt-0.5"
            style={{ color: bfSeverity.fg }}
          >
            {bf}
          </p>
          <p
            className="text-[10px] mt-0.5 leading-snug"
            style={{ color: bfSeverity.fg }}
          >
            {bfSeverity.note}
          </p>
        </div>
      </div>

      {/* Contributor table */}
      <div className="border border-border rounded-md overflow-hidden">
        <div className="grid grid-cols-[2.25rem_1fr_5rem_8rem_5rem_4rem] gap-3 px-3 py-2 text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground bg-muted/40 border-b border-border">
          <span></span>
          <span>Contributor &amp; activity</span>
          <span className="text-right">Commits</span>
          <span>Share</span>
          <span className="text-right">Recent</span>
          <span></span>
        </div>
        {contributors.map((c) => {
          const meta = CONTRIBUTOR_STATUS_META[c.status];
          const barPct = Math.max(2, (c.contributions / maxContribs) * 100);
          return (
            <a
              key={c.login}
              href={c.htmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="grid grid-cols-[2.25rem_1fr_5rem_8rem_5rem_4rem] gap-3 items-center px-3 py-2 hover:bg-muted/40 transition-colors border-b border-border last:border-b-0"
            >
              {/* Avatar — fall back to letter if image fails */}
              <div className="w-7 h-7 rounded-full overflow-hidden bg-muted border border-border flex items-center justify-center text-[11px] font-mono uppercase text-muted-foreground shrink-0">
                {c.avatarUrl ? (
                  <img
                    src={c.avatarUrl}
                    alt={c.login}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.currentTarget as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  c.login.slice(0, 1)
                )}
              </div>

              <span className="min-w-0">
                <span className="flex items-center gap-1.5 min-w-0">
                  <span
                    className="text-[12.5px] font-mono truncate text-foreground"
                    title={c.login}
                  >
                    {c.login}
                  </span>
                  {c.isBot && (
                    <span
                      className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[9.5px] font-medium shrink-0"
                      style={{
                        background: CONTRIBUTOR_STATUS_META.bot.bg,
                        color: CONTRIBUTOR_STATUS_META.bot.fg,
                        borderColor: CONTRIBUTOR_STATUS_META.bot.border,
                      }}
                    >
                      <Bot className="w-2.5 h-2.5" />
                      Bot
                    </span>
                  )}
                  <span
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-medium shrink-0"
                    style={{
                      background: meta.bg,
                      color: meta.fg,
                      border: `1px solid ${meta.border}`,
                    }}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ background: meta.dot }}
                    />
                    {meta.label}
                  </span>
                </span>
                <span className="block text-[11px] text-muted-foreground truncate mt-0.5">
                  {c.evidence}
                </span>
              </span>

              <span className="text-right text-[11.5px] font-mono tabular-nums">
                {c.contributions.toLocaleString()}
              </span>

              <span className="flex items-center gap-2">
                <span className="h-1.5 flex-1 bg-border rounded-full overflow-hidden">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${barPct}%`,
                      background: c.isBot
                        ? "linear-gradient(90deg, #818cf8, #4338ca)"
                        : "linear-gradient(90deg, #475569, #0f172a)",
                    }}
                  />
                </span>
                <span className="text-[10.5px] text-muted-foreground tabular-nums w-9 text-right">
                  {c.contributionPct.toFixed(1)}%
                </span>
              </span>

              <span className="text-right text-[11px] font-mono tabular-nums text-muted-foreground">
                {c.recentCommits > 0 ? `${c.recentCommits}` : "—"}
              </span>

              <ExternalLink className="w-3 h-3 text-muted-foreground justify-self-end" />
            </a>
          );
        })}
      </div>
    </div>
  );
}

function ContributorStat({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color?: string;
  icon?: any;
}) {
  return (
    <div className="border border-border rounded-md p-2.5">
      <p className="text-[9.5px] uppercase tracking-wider font-medium text-muted-foreground flex items-center gap-1">
        {Icon && <Icon className="w-2.5 h-2.5" />}
        {label}
      </p>
      <p
        className="text-[16px] font-semibold tabular-nums leading-none mt-0.5"
        style={{ color: color ?? "inherit" }}
      >
        {value.toLocaleString()}
      </p>
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
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono font-medium">
                            ${r.costUsd.toFixed(5)}
                          </span>
                          {r.pricingMatch === "unknown" && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[9.5px] font-medium uppercase tracking-wider"
                              style={{
                                color: "#b91c1c",
                                background: "rgba(185,28,28,0.06)",
                                borderColor: "rgba(185,28,28,0.30)",
                              }}
                              title={`No pricing entry for "${r.model}" — cost recorded as $0 but is unreliable`}
                            >
                              <AlertCircle className="w-2.5 h-2.5" />
                              unknown
                            </span>
                          )}
                          {r.pricingMatch === "normalized" && (
                            <span
                              className="inline-flex items-center px-1 py-0.5 rounded border text-[9.5px] font-medium uppercase tracking-wider"
                              style={{
                                color: "#854d0e",
                                background: "rgba(202,138,4,0.08)",
                                borderColor: "rgba(202,138,4,0.30)",
                              }}
                              title={`Cost computed via normalized model id (response was "${r.model}", matched a bare key in MODEL_PRICING)`}
                            >
                              est
                            </span>
                          )}
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
