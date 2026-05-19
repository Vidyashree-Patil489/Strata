import { useState, useEffect, useMemo, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Loader2,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  GitCommit,
  Hammer,
  ArrowLeftRight,
  Layers,
  X,
  Sparkles,
  Plus,
  Minus,
  CheckCircle2,
  FileCode,
  ExternalLink,
  Code2,
  History as HistoryIcon,
  FileDiff,
} from "lucide-react";
import api from "../api/axios";
import { useSocket } from "../hooks/useSocket";
import { useAuth } from "../context/AuthContext";
import {
  GraphCanvas,
  type GraphNode,
  type GraphEdge,
  type DiffState,
} from "../components/graph/GraphCanvas";

interface Repo {
  _id: string;
  fullName: string;
}

interface SnapshotMeta {
  commitSha: string;
  commitShortSha: string;
  commitDate: string;
  commitAuthor: string;
  commitMessage: string;
  filesAdded: number;
  filesRemoved: number;
  nodeCount: number;
  edgeCount: number;
  source: "current" | "historical";
  createdAt: string;
}

interface SnapshotFull extends SnapshotMeta {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

interface CommitInRange {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

interface FilePatch {
  filename: string;
  status: string; // added | modified | removed | renamed | …
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
  addedSymbols: string[];
  removedSymbols: string[];
  url: string;
}

interface DiffResponse {
  from: SnapshotMeta;
  to: SnapshotMeta;
  nodes: { added: string[]; removed: string[]; unchanged: string[] };
  edges: {
    added: Array<{ source: string; target: string }>;
    removed: Array<{ source: string; target: string }>;
  };
  dirStats: Array<{ dir: string; added: number; removed: number }>;
  metrics: {
    nodeDelta: number;
    edgeDelta: number;
    commitsInRange?: number;
    filesChanged?: number;
    totalAdditions?: number;
    totalDeletions?: number;
    symbolsAdded?: number;
    symbolsRemoved?: number;
  };
  commits?: CommitInRange[];
  filePatches?: FilePatch[];
  compareError?: string | null;
}

interface BuildStatus {
  state: "idle" | "waiting" | "active" | "completed" | "failed" | "unavailable";
  progress?: number;
  commitCount?: number;
  failedReason?: string;
}

/**
 * Knowledge Graph — visualize the repo's dependency structure at any
 * commit, and diff two commits to see how the codebase has shifted.
 *
 * Two modes:
 *  - "view"  → render one snapshot (default: most recent)
 *  - "diff"  → render the "to" snapshot with diff overlay coloring,
 *              plus a metrics sidepanel showing what changed
 */
export default function KnowledgeGraph() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [repos, setRepos] = useState<Repo[]>([]);
  const [reposLoading, setReposLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[] | null>(null);
  const [snapsLoading, setSnapsLoading] = useState(false);
  const [current, setCurrent] = useState<SnapshotFull | null>(null);
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [missingSha, setMissingSha] = useState<string | null>(null);
  const [buildPending, setBuildPending] = useState(false);
  const [buildToast, setBuildToast] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus | null>(null);
  const [buildProgress, setBuildProgress] = useState<{
    completed: number;
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    currentSha?: string;
  } | null>(null);
  const [repoDropdownOpen, setRepoDropdownOpen] = useState(false);

  // ── URL state ──
  const activeRepoId = searchParams.get("repoId") || repos[0]?._id;
  const activeRepo = repos.find((r) => r._id === activeRepoId);
  const mode = (searchParams.get("mode") as "view" | "diff") || "view";
  const fromSha = searchParams.get("from");
  const toSha = searchParams.get("to") || snapshots?.[0]?.commitSha;

  // ── Fetch repos ──
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

  // ── Fetch snapshots list when repo changes ──
  const fetchSnapshots = useCallback(async (repoId: string) => {
    setSnapsLoading(true);
    try {
      const { data } = await api.get(`/repos/${repoId}/graph/snapshots`);
      setSnapshots(data.snapshots || []);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load snapshots");
    } finally {
      setSnapsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeRepoId) return;
    setCurrent(null);
    setDiff(null);
    setError(null);
    fetchSnapshots(activeRepoId);
  }, [activeRepoId, fetchSnapshots]);

  // ── Fetch single snapshot when toSha changes (view mode) ──
  useEffect(() => {
    if (mode !== "view" || !activeRepoId || !toSha) return;
    setMissingSha(null);
    api
      .get(`/repos/${activeRepoId}/graph/${toSha}`)
      .then(({ data }) => setCurrent(data))
      .catch((err) => {
        // Soft-fail: if the requested commit hasn't been snapshotted, fall
        // back to the most recent snapshot so the page still shows
        // something useful, and surface a banner explaining why.
        const latest = snapshots?.[0]?.commitSha;
        if (err.response?.status === 404 && latest && latest !== toSha) {
          setMissingSha(toSha);
          const sp = new URLSearchParams(searchParams);
          sp.set("to", latest);
          setSearchParams(sp, { replace: true });
        } else {
          setCurrent(null);
          setError(err.response?.data?.error || "Failed to load snapshot");
        }
      });
  }, [mode, activeRepoId, toSha, snapshots, searchParams, setSearchParams]);

  // ── Fetch diff when in diff mode with both SHAs ──
  useEffect(() => {
    if (mode !== "diff" || !activeRepoId || !fromSha || !toSha) return;
    Promise.all([
      api.get(`/repos/${activeRepoId}/graph/${toSha}`),
      api.get(`/repos/${activeRepoId}/graph/diff`, {
        params: { from: fromSha, to: toSha },
      }),
    ])
      .then(([toRes, diffRes]) => {
        setCurrent(toRes.data);
        setDiff(diffRes.data);
      })
      .catch((err) => {
        setCurrent(null);
        setDiff(null);
        setError(err.response?.data?.error || "Failed to load diff");
      });
  }, [mode, activeRepoId, fromSha, toSha]);

  // ── Fetch build status on load + poll if active ──
  const fetchBuildStatus = useCallback(async (repoId: string) => {
    try {
      const { data } = await api.get(`/repos/${repoId}/graph/build/status`);
      setBuildStatus(data);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!activeRepoId) return;
    fetchBuildStatus(activeRepoId);
  }, [activeRepoId, fetchBuildStatus]);

  // ── Socket events for live build progress ──
  const { on } = useSocket(user?._id);
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    cleanups.push(
      on("graph:build:started", (d: any) => {
        if (d.repoId !== activeRepoId) return;
        setBuildStatus({ state: "active", progress: 0, commitCount: d.commitCount });
        setBuildProgress({
          completed: 0,
          total: d.commitCount,
          succeeded: 0,
          failed: 0,
          skipped: 0,
        });
      }),
    );
    cleanups.push(
      on("graph:build:progress", (d: any) => {
        if (d.repoId !== activeRepoId) return;
        setBuildProgress({
          completed: d.completed,
          total: d.total,
          succeeded: d.succeeded,
          failed: d.failed,
          skipped: d.skipped,
          currentSha: d.currentSha,
        });
      }),
    );
    cleanups.push(
      on("graph:build:completed", (d: any) => {
        if (d.repoId !== activeRepoId) return;
        setBuildStatus({ state: "completed", progress: 100 });
        setBuildProgress(null);
        // Reload the snapshot list
        if (activeRepoId) fetchSnapshots(activeRepoId);
      }),
    );
    cleanups.push(
      on("graph:build:failed", (d: any) => {
        if (d.repoId !== activeRepoId) return;
        setBuildStatus({ state: "failed", failedReason: d.error });
        setBuildProgress(null);
      }),
    );
    return () => cleanups.forEach((c) => c());
  }, [activeRepoId, on, fetchSnapshots]);

  // ── Build history button ──
  const [commitCount, setCommitCount] = useState(30);
  const handleBuildHistory = async () => {
    if (!activeRepoId || buildPending) return;
    setBuildPending(true);
    // Optimistic: flip into "waiting" right away so the user sees the
    // progress banner immediately, even before the POST round-trips and
    // the first socket event lands. Real socket events overwrite this.
    setBuildStatus({ state: "waiting", commitCount });
    try {
      const { data } = await api.post(`/repos/${activeRepoId}/graph/build`, {
        commitCount,
      });
      setBuildStatus({
        state: "active",
        commitCount: data.commitCount ?? commitCount,
      });
      setBuildToast(
        data.message ||
          `Queued build for the last ${data.commitCount ?? commitCount} commits`,
      );
      // Auto-clear toast after a few seconds — the progress banner
      // takes over as the source of truth.
      setTimeout(() => setBuildToast(null), 4000);
      // Verify with the authoritative status endpoint in case the
      // socket connection isn't healthy.
      fetchBuildStatus(activeRepoId);
    } catch (err: any) {
      setBuildStatus(null);
      setError(err.response?.data?.error || "Failed to start build");
    } finally {
      setBuildPending(false);
    }
  };

  // ── Decorate nodes/edges with diff state when in diff mode ──
  const renderNodes = useMemo<GraphNode[]>(() => {
    if (!current) return [];
    if (mode === "diff" && diff) {
      const added = new Set(diff.nodes.added);
      const removed = new Set(diff.nodes.removed);
      // Build a combined node set: all "to" nodes + the removed nodes
      // (which aren't in "to" — they need to be drawn with a phantom).
      const combined: GraphNode[] = current.nodes.map((n) => ({
        ...n,
        diff: added.has(n.id) ? ("added" as DiffState) : ("unchanged" as DiffState),
      }));
      for (const id of diff.nodes.removed) {
        combined.push({
          id,
          label: id.split("/").pop() || id,
          dir: id.includes("/") ? id.split("/")[0] : ".",
          pageRank: 0,
          defCount: 0,
          diff: "removed" as DiffState,
        });
      }
      return combined;
    }
    return current.nodes;
  }, [current, mode, diff]);

  const renderEdges = useMemo<GraphEdge[]>(() => {
    if (!current) return [];
    if (mode === "diff" && diff) {
      const addedKey = new Set(diff.edges.added.map((e) => `${e.source}|${e.target}`));
      const decorated: GraphEdge[] = current.edges.map((e) => ({
        ...e,
        diff: addedKey.has(`${e.source}|${e.target}`)
          ? ("added" as DiffState)
          : ("unchanged" as DiffState),
      }));
      // Add phantom removed edges so the user can see what was unhooked
      for (const e of diff.edges.removed) {
        decorated.push({ source: e.source, target: e.target, diff: "removed" });
      }
      return decorated;
    }
    return current.edges;
  }, [current, mode, diff]);

  /* ── Header ── */
  const Header = (
    <div className="flex items-end justify-between gap-4 mb-6 pb-6 border-b border-border">
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] font-medium text-muted-foreground mb-2">
          Knowledge graph
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight leading-none">
          {activeRepo?.fullName || "Codebase shape"}
        </h1>
        <p className="mt-3 text-[13px] text-muted-foreground max-w-2xl leading-relaxed">
          Files as nodes, imports as edges, grouped by top-level directory.
          Build snapshots of past commits to see how the structure shifts
          over time. Pure tree-sitter — no LLM cost.
        </p>
      </div>

      {repos.length > 0 && (
        <div className="relative">
          <button
            onClick={() => setRepoDropdownOpen(!repoDropdownOpen)}
            className="clay-btn px-3 py-2 text-[12.5px] flex items-center gap-2 min-w-[220px] justify-between"
          >
            <span className="truncate">
              {activeRepo?.fullName || "Select repo"}
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 shrink-0 transition-transform ${repoDropdownOpen ? "rotate-180" : ""}`}
            />
          </button>
          {repoDropdownOpen && (
            <div className="absolute right-0 top-full mt-1 bg-card border border-border rounded-md py-1 z-50 w-72 max-h-72 overflow-auto">
              {repos.map((r) => (
                <button
                  key={r._id}
                  onClick={() => {
                    setSearchParams({ repoId: r._id });
                    setRepoDropdownOpen(false);
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

  if (reposLoading) {
    return (
      <div>
        {Header}
        <div className="clay-card p-6 h-40 animate-pulse" />
      </div>
    );
  }

  if (snapsLoading) {
    return (
      <div>
        {Header}
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
        </div>
      </div>
    );
  }

  // No snapshots at all → prompt user to index first
  if (!snapshots || snapshots.length === 0) {
    return (
      <div>
        {Header}
        <div className="clay-card p-10 flex flex-col items-center text-center">
          <Layers className="w-7 h-7 text-muted-foreground" />
          <h3 className="mt-4 text-[15px] font-semibold">No graph yet</h3>
          <p className="mt-2 text-[13px] text-muted-foreground max-w-md leading-relaxed">
            Trigger an index from the Repos page first — the current
            snapshot is built automatically. After that, return here and
            click "Build history" to snapshot older commits.
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

  const isBuilding = buildStatus?.state === "active" || buildStatus?.state === "waiting";

  return (
    <div>
      {Header}

      {/* Controls strip */}
      <div className="clay-card p-3 mb-3 flex flex-wrap items-center gap-3">
        {/* Mode toggle */}
        <div className="flex items-center gap-1 border border-border rounded-md p-0.5">
          <button
            onClick={() => {
              const sp = new URLSearchParams(searchParams);
              sp.delete("mode");
              sp.delete("from");
              setSearchParams(sp);
            }}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors ${
              mode === "view"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Layers className="w-3 h-3" />
            View
          </button>
          <button
            onClick={() => {
              if (snapshots.length < 2) return;
              const sp = new URLSearchParams(searchParams);
              sp.set("mode", "diff");
              // Default to the OLDEST → NEWEST snapshot so the diff
              // shows the most history. Diffing the two most recent
              // commits is almost always boring (no file-level
              // changes), which makes the page look broken on first
              // open. The user can narrow the range from the picker.
              if (!sp.get("from")) {
                sp.set("from", snapshots[snapshots.length - 1].commitSha);
              }
              if (!sp.get("to")) sp.set("to", snapshots[0].commitSha);
              setSearchParams(sp);
            }}
            disabled={snapshots.length < 2}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[12px] transition-colors disabled:opacity-40 ${
              mode === "diff"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground"
            }`}
            title={
              snapshots.length < 2
                ? "Need at least 2 snapshots to diff"
                : undefined
            }
          >
            <ArrowLeftRight className="w-3 h-3" />
            Diff
          </button>
        </div>

        {/* Commit pickers */}
        {mode === "view" && (
          <CommitPicker
            label="Commit"
            snapshots={snapshots}
            value={toSha || ""}
            onChange={(sha) => {
              const sp = new URLSearchParams(searchParams);
              sp.set("to", sha);
              setSearchParams(sp);
            }}
          />
        )}
        {mode === "diff" && (
          <>
            <CommitPicker
              label="From"
              snapshots={snapshots}
              value={fromSha || ""}
              onChange={(sha) => {
                const sp = new URLSearchParams(searchParams);
                sp.set("from", sha);
                setSearchParams(sp);
              }}
            />
            <span className="text-muted-foreground">→</span>
            <CommitPicker
              label="To"
              snapshots={snapshots}
              value={toSha || ""}
              onChange={(sha) => {
                const sp = new URLSearchParams(searchParams);
                sp.set("to", sha);
                setSearchParams(sp);
              }}
            />
          </>
        )}

        {/* Build history button */}
        {!isBuilding && (
          <div className="ml-auto flex items-center gap-2">
            <label className="text-[11px] text-muted-foreground">
              Commits:
              <input
                type="number"
                min={1}
                max={200}
                value={commitCount}
                onChange={(e) => setCommitCount(Math.max(1, Math.min(200, parseInt(e.target.value) || 30)))}
                className="ml-1 w-14 bg-card border border-border rounded px-1.5 py-0.5 text-[11px] font-mono tabular-nums"
              />
            </label>
            <button
              onClick={handleBuildHistory}
              disabled={buildPending}
              className="clay-btn px-2.5 py-1.5 text-[12px] flex items-center gap-1.5 disabled:opacity-50"
            >
              {buildPending ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Hammer className="w-3 h-3" />
              )}
              {buildPending ? "Queueing…" : "Build history"}
            </button>
          </div>
        )}
      </div>

      {/* Build progress banner */}
      {isBuilding && (
        <div className="clay-card p-4 mb-3 border-l-2" style={{ borderLeftColor: "var(--primary)" }}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
              <p className="text-[13px] font-medium">Building historical snapshots</p>
            </div>
            {buildProgress && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {buildProgress.completed} / {buildProgress.total}
              </p>
            )}
          </div>
          {buildProgress && (
            <>
              <div className="w-full h-1 bg-border rounded-full overflow-hidden mb-2">
                <div
                  className="h-full bg-foreground transition-[width]"
                  style={{
                    width: `${Math.round((buildProgress.completed / buildProgress.total) * 100)}%`,
                  }}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {buildProgress.currentSha ? (
                  <>
                    Working on <span className="font-mono">{buildProgress.currentSha}</span>
                    {" · "}
                  </>
                ) : null}
                <span className="text-foreground">{buildProgress.succeeded}</span> succeeded
                {" · "}
                <span className="text-foreground">{buildProgress.skipped}</span> skipped
                {buildProgress.failed > 0 && (
                  <>
                    {" · "}
                    <span className="text-destructive">{buildProgress.failed}</span> failed
                  </>
                )}
              </p>
            </>
          )}
        </div>
      )}

      {/* Build queued toast */}
      {buildToast && (
        <div
          className="clay-card px-4 py-2.5 mb-3 flex items-center gap-2.5 border-l-2"
          style={{ borderLeftColor: "var(--chart-5)" }}
        >
          <CheckCircle2
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: "var(--chart-5)" }}
          />
          <p className="flex-1 text-[12.5px]">{buildToast}</p>
          <button
            onClick={() => setBuildToast(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Missing snapshot banner — shown when the requested commit
          doesn't have a built snapshot and we fell back to the latest. */}
      {missingSha && (
        <div className="px-4 py-3 mb-3 border border-border bg-muted/40 rounded-md flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-[12.5px] font-medium">
              Commit{" "}
              <span className="font-mono">{missingSha.slice(0, 7)}</span> hasn't
              been snapshotted yet
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-relaxed">
              Showing the latest available snapshot instead. Click{" "}
              <span className="font-medium text-foreground">Build history</span>{" "}
              to backfill older commits — snapshots only exist for the most
              recent indexed commit until you do.
            </p>
          </div>
          <button
            onClick={() => setMissingSha(null)}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="px-4 py-3 mb-3 border border-destructive/30 bg-destructive/[0.04] rounded-md flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="flex-1 text-[13px] text-destructive">{error}</p>
          <button onClick={() => setError(null)} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Main grid: graph + sidepanel */}
      <div className={`grid gap-3 ${mode === "diff" ? "grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-1"}`}>
        {/* Canvas */}
        <div className="clay-card overflow-hidden">
          {!current ? (
            <div className="flex items-center justify-center h-[600px]">
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
            </div>
          ) : (
            <div className="h-[700px]">
              <GraphCanvas
                nodes={renderNodes}
                edges={renderEdges}
                showDiff={mode === "diff"}
                repoId={activeRepoId}
              />
            </div>
          )}
        </div>

        {/* Diff sidepanel */}
        {mode === "diff" && diff && (
          <DiffSidepanel diff={diff} />
        )}
      </div>

      {/* Snapshot detail strip — show commit info under canvas */}
      {current && (
        <div className="mt-3 clay-card p-4 flex items-center gap-4 flex-wrap">
          <GitCommit className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-mono tabular-nums">{current.commitShortSha}</p>
            <p className="text-[12.5px] text-foreground truncate">{current.commitMessage}</p>
            <p className="text-[10.5px] text-muted-foreground mt-0.5">
              {current.commitAuthor} · {new Date(current.commitDate).toLocaleString()}
            </p>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-muted-foreground shrink-0">
            <span className="font-mono tabular-nums">{current.nodeCount} files</span>
            <span className="font-mono tabular-nums">{current.edgeCount} edges</span>
            {current.source === "current" && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
                style={{ color: "var(--chart-5)", background: "rgba(21, 128, 61, 0.08)" }}
              >
                <Sparkles className="w-2.5 h-2.5" />
                latest
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Rich diff sections (commits + file patches) ── */}
      {mode === "diff" && diff && (
        <DiffNarrative diff={diff} />
      )}
    </div>
  );
}

/* ─── Helper components ──────────────────────────────────────── */

function CommitPicker({
  label,
  snapshots,
  value,
  onChange,
}: {
  label: string;
  snapshots: SnapshotMeta[];
  value: string;
  onChange: (sha: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = snapshots.find((s) => s.commitSha === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="clay-btn px-2.5 py-1.5 text-[12px] flex items-center gap-2 min-w-[200px] justify-between"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-[10.5px] uppercase tracking-[0.06em] text-muted-foreground">
            {label}
          </span>
          <span className="font-mono tabular-nums truncate">
            {selected?.commitShortSha || "—"}
          </span>
        </span>
        <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 bg-card border border-border rounded-md py-1 z-50 w-96 max-h-96 overflow-auto">
          {snapshots.map((s) => (
            <button
              key={s.commitSha}
              onClick={() => {
                onChange(s.commitSha);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 hover:bg-muted ${
                s.commitSha === value ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono tabular-nums">{s.commitShortSha}</span>
                <span className="text-[11px] text-muted-foreground">
                  {new Date(s.commitDate).toLocaleDateString()}
                </span>
                {s.source === "current" && (
                  <CheckCircle2 className="w-3 h-3" style={{ color: "var(--chart-5)" }} />
                )}
              </div>
              <p className="text-[11px] text-foreground truncate mt-0.5">
                {s.commitMessage}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {s.commitAuthor} · {s.nodeCount}n/{s.edgeCount}e
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffSidepanel({ diff }: { diff: DiffResponse }) {
  const totalChanges =
    diff.nodes.added.length +
    diff.nodes.removed.length +
    diff.edges.added.length +
    diff.edges.removed.length;
  const isEmpty = totalChanges === 0;

  return (
    <div className="clay-card p-4 lg:sticky lg:top-4 h-fit">
      {/* From → To header so it's always clear what's being compared */}
      <div className="pb-3 mb-3 border-b border-border">
        <p className="text-[10.5px] uppercase tracking-[0.06em] font-medium text-muted-foreground mb-1.5">
          Comparing
        </p>
        <div className="space-y-1.5 text-[11.5px]">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground w-8">
              from
            </span>
            <span className="font-mono tabular-nums">{diff.from.commitShortSha}</span>
            <span className="text-muted-foreground truncate">{diff.from.commitMessage}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] uppercase tracking-[0.06em] text-muted-foreground w-8">
              to
            </span>
            <span className="font-mono tabular-nums">{diff.to.commitShortSha}</span>
            <span className="text-muted-foreground truncate">{diff.to.commitMessage}</span>
          </div>
        </div>
      </div>

      {isEmpty ? (
        // Explicit empty state — without this, an unchanged diff makes the
        // page look broken. Most pairs of adjacent commits don't change
        // file structure (only file contents), so this fires more often
        // than you'd think.
        <div className="py-6 text-center">
          <CheckCircle2
            className="w-5 h-5 mx-auto mb-2"
            style={{ color: "var(--chart-5)" }}
          />
          <p className="text-[12.5px] font-medium">
            No structural changes
          </p>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground leading-relaxed">
            These two commits have the same file structure and import
            graph. Pick commits further apart to see real diffs &mdash;
            try the oldest snapshot in the From picker.
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            <DiffMetric
              label="Files (graph)"
              delta={diff.metrics.nodeDelta}
              add={diff.nodes.added.length}
              remove={diff.nodes.removed.length}
            />
            <DiffMetric
              label="Edges"
              delta={diff.metrics.edgeDelta}
              add={diff.edges.added.length}
              remove={diff.edges.removed.length}
            />
            {diff.metrics.filesChanged !== undefined && (
              <DiffMetric
                label="Files touched"
                delta={diff.metrics.filesChanged}
                add={diff.metrics.totalAdditions ?? 0}
                remove={diff.metrics.totalDeletions ?? 0}
                addLabel="lines+"
                removeLabel="lines−"
              />
            )}
            {(diff.metrics.symbolsAdded || diff.metrics.symbolsRemoved) ? (
              <DiffMetric
                label="Symbols"
                delta={(diff.metrics.symbolsAdded ?? 0) - (diff.metrics.symbolsRemoved ?? 0)}
                add={diff.metrics.symbolsAdded ?? 0}
                remove={diff.metrics.symbolsRemoved ?? 0}
              />
            ) : null}
            {diff.metrics.commitsInRange !== undefined && diff.metrics.commitsInRange > 0 && (
              <div className="border border-border rounded-md p-2.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-[12px] font-medium">Commits</span>
                  <span className="text-[18px] font-mono tabular-nums leading-none">
                    {diff.metrics.commitsInRange}
                  </span>
                </div>
                <p className="text-[10.5px] text-muted-foreground mt-1.5">
                  between {diff.from.commitShortSha} and {diff.to.commitShortSha}
                </p>
              </div>
            )}
          </div>

          {diff.dirStats.length > 0 && (
            <>
              <p className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground mt-5 mb-2">
                Per directory
              </p>
              <ul className="divide-y divide-border border-t border-border">
                {diff.dirStats
                  .sort((a, b) => b.added + b.removed - (a.added + a.removed))
                  .map((d) => (
                    <li
                      key={d.dir}
                      className="flex items-center justify-between py-1.5 text-[11.5px]"
                    >
                      <span className="font-mono">{d.dir}/</span>
                      <span className="flex items-center gap-2 tabular-nums">
                        {d.added > 0 && (
                          <span
                            className="flex items-center gap-0.5"
                            style={{ color: "var(--chart-5)" }}
                          >
                            <Plus className="w-2.5 h-2.5" />
                            {d.added}
                          </span>
                        )}
                        {d.removed > 0 && (
                          <span className="flex items-center gap-0.5 text-destructive">
                            <Minus className="w-2.5 h-2.5" />
                            {d.removed}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            </>
          )}

          {diff.nodes.added.length > 0 && (
            <CollapsibleFileList
              label="Added files"
              color="var(--chart-5)"
              files={diff.nodes.added}
            />
          )}
          {diff.nodes.removed.length > 0 && (
            <CollapsibleFileList
              label="Removed files"
              color="var(--destructive)"
              files={diff.nodes.removed}
            />
          )}
        </>
      )}
    </div>
  );
}

function DiffMetric({
  label,
  delta,
  add,
  remove,
  addLabel = "",
  removeLabel = "",
}: {
  label: string;
  delta: number;
  add: number;
  remove: number;
  /** Optional suffix shown after the +N (e.g. "lines+"). */
  addLabel?: string;
  removeLabel?: string;
}) {
  return (
    <div className="border border-border rounded-md p-2.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[12px] font-medium">{label}</span>
        <span
          className="text-[18px] font-mono tabular-nums leading-none"
          style={{
            color:
              delta > 0
                ? "var(--chart-5)"
                : delta < 0
                  ? "var(--destructive)"
                  : "var(--foreground)",
          }}
        >
          {delta > 0 ? "+" : ""}
          {delta}
        </span>
      </div>
      <p className="text-[10.5px] text-muted-foreground tabular-nums mt-1.5">
        <span style={{ color: "var(--chart-5)" }}>
          +{add}
          {addLabel && ` ${addLabel}`}
        </span>
        {" / "}
        <span className="text-destructive">
          −{remove}
          {removeLabel && ` ${removeLabel}`}
        </span>
      </p>
    </div>
  );
}

function CollapsibleFileList({
  label,
  color,
  files,
}: {
  label: string;
  color: string;
  files: string[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="text-[11.5px] flex items-center gap-1.5 hover:text-foreground"
      >
        <ChevronDown
          className={`w-3 h-3 transition-transform ${open ? "" : "-rotate-90"}`}
        />
        <span style={{ color }}>{label}</span>
        <span className="text-muted-foreground font-mono tabular-nums">
          {files.length}
        </span>
      </button>
      {open && (
        <ul className="mt-2 max-h-48 overflow-y-auto space-y-0.5 pl-4">
          {files.map((f) => (
            <li key={f} className="text-[11px] font-mono text-muted-foreground truncate">
              {f}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ─── Rich narrative sections under the canvas ─────────────────── */

/**
 * Three stacked sections that put the diff in context:
 *   1. Commits in this range — git log between from..to
 *   2. Files changed — every file with inline patch viewer
 *   3. (Compare error message if GitHub call failed)
 */
function DiffNarrative({ diff }: { diff: DiffResponse }) {
  const hasCommits = (diff.commits?.length ?? 0) > 0;
  const hasFiles = (diff.filePatches?.length ?? 0) > 0;

  if (!hasCommits && !hasFiles) {
    if (diff.compareError) {
      return (
        <div className="mt-3 clay-card p-4 flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
          <div>
            <p className="text-[12.5px] font-medium">
              Rich diff data unavailable
            </p>
            <p className="text-[11.5px] text-muted-foreground mt-0.5">
              {diff.compareError}
            </p>
          </div>
        </div>
      );
    }
    return null;
  }

  return (
    <>
      {hasCommits && <CommitsInRangeSection commits={diff.commits!} />}
      {hasFiles && <FileChangesSection files={diff.filePatches!} />}
    </>
  );
}

function CommitsInRangeSection({ commits }: { commits: CommitInRange[] }) {
  const [expandAll, setExpandAll] = useState(false);
  const display = expandAll ? commits : commits.slice(0, 10);

  return (
    <div className="mt-3 clay-card p-5">
      <div className="flex items-baseline justify-between mb-3 pb-3 border-b border-border">
        <div>
          <p className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground mb-0.5">
            Commits in range
          </p>
          <p className="text-[15px] font-semibold tracking-tight">
            {commits.length} commit{commits.length === 1 ? "" : "s"}
          </p>
        </div>
        <HistoryIcon className="w-4 h-4 text-muted-foreground" />
      </div>

      <ol className="divide-y divide-border border-t border-border">
        {display.map((c) => (
          <li key={c.sha} className="py-2.5 flex items-start gap-3">
            <GitCommit className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11.5px] font-mono tabular-nums text-foreground hover:underline"
                >
                  {c.shortSha}
                </a>
                <span className="text-[10.5px] text-muted-foreground">
                  {new Date(c.date).toLocaleString()}
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  · {c.author}
                </span>
              </div>
              <p className="text-[12.5px] text-foreground mt-0.5 truncate">
                {c.message}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {commits.length > display.length && (
        <button
          onClick={() => setExpandAll(true)}
          className="mt-3 text-[11.5px] text-foreground hover:underline flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3" />
          Show all {commits.length} commits
        </button>
      )}
      {expandAll && commits.length > 10 && (
        <button
          onClick={() => setExpandAll(false)}
          className="mt-3 text-[11.5px] text-muted-foreground hover:text-foreground"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function FileChangesSection({ files }: { files: FilePatch[] }) {
  const [filter, setFilter] = useState<"all" | "added" | "modified" | "removed">("all");
  const filtered = files.filter((f) => {
    if (filter === "all") return true;
    return f.status === filter;
  });

  const totalAdd = files.reduce((s, f) => s + f.additions, 0);
  const totalDel = files.reduce((s, f) => s + f.deletions, 0);

  return (
    <div className="mt-3 clay-card p-5">
      <div className="flex items-baseline justify-between mb-3 pb-3 border-b border-border">
        <div>
          <p className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground mb-0.5">
            Files changed
          </p>
          <div className="flex items-baseline gap-3">
            <p className="text-[15px] font-semibold tracking-tight">
              {files.length} file{files.length === 1 ? "" : "s"}
            </p>
            <span className="text-[11.5px] tabular-nums" style={{ color: "var(--chart-5)" }}>
              +{totalAdd.toLocaleString()}
            </span>
            <span className="text-[11.5px] tabular-nums text-destructive">
              −{totalDel.toLocaleString()}
            </span>
          </div>
        </div>
        <FileDiff className="w-4 h-4 text-muted-foreground" />
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1 mb-3 flex-wrap">
        {(["all", "added", "modified", "removed"] as const).map((opt) => {
          const count =
            opt === "all" ? files.length : files.filter((f) => f.status === opt).length;
          if (opt !== "all" && count === 0) return null;
          const isActive = filter === opt;
          return (
            <button
              key={opt}
              onClick={() => setFilter(opt)}
              className={`px-2 py-0.5 rounded text-[11px] transition-colors ${
                isActive
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt} <span className="font-mono tabular-nums opacity-70">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="space-y-1.5">
        {filtered.map((f) => (
          <FilePatchRow key={f.filename} file={f} />
        ))}
      </div>
    </div>
  );
}

function FilePatchRow({ file }: { file: FilePatch }) {
  const [open, setOpen] = useState(false);
  const statusColor =
    file.status === "added"
      ? "var(--chart-5)"
      : file.status === "removed"
        ? "var(--destructive)"
        : file.status === "renamed"
          ? "var(--chart-3)"
          : "var(--muted-foreground)";

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
        )}
        <FileCode className="w-3.5 h-3.5 shrink-0" style={{ color: statusColor }} />
        <span className="text-[12px] font-mono flex-1 truncate">{file.filename}</span>
        <span
          className="text-[10px] uppercase tracking-[0.06em] font-medium px-1.5 py-0.5 rounded shrink-0"
          style={{ color: statusColor, background: `color-mix(in srgb, ${statusColor} 8%, transparent)` }}
        >
          {file.status}
        </span>
        <div className="flex items-center gap-2 shrink-0 text-[11px] tabular-nums">
          {file.additions > 0 && (
            <span style={{ color: "var(--chart-5)" }}>+{file.additions}</span>
          )}
          {file.deletions > 0 && (
            <span className="text-destructive">−{file.deletions}</span>
          )}
        </div>
        <a
          href={file.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-foreground shrink-0"
          title="Open in GitHub"
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      </button>

      {open && (
        <div className="border-t border-border bg-muted/20">
          {/* Symbol changes for this file */}
          {(file.addedSymbols.length > 0 || file.removedSymbols.length > 0) && (
            <div className="px-3 py-2 border-b border-border space-y-1">
              <p className="text-[10px] uppercase tracking-[0.06em] font-medium text-muted-foreground flex items-center gap-1.5">
                <Code2 className="w-2.5 h-2.5" />
                Symbol changes
              </p>
              <div className="flex flex-wrap gap-1">
                {file.addedSymbols.map((s) => (
                  <span
                    key={"a:" + s}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-mono"
                    style={{
                      color: "var(--chart-5)",
                      background: "rgba(21, 128, 61, 0.08)",
                    }}
                  >
                    + {s}
                  </span>
                ))}
                {file.removedSymbols.map((s) => (
                  <span
                    key={"r:" + s}
                    className="inline-flex items-center px-1.5 py-0.5 rounded text-[10.5px] font-mono text-destructive"
                    style={{ background: "rgba(185, 28, 28, 0.06)" }}
                  >
                    − {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Inline patch */}
          {file.patch ? (
            <div className="font-mono text-[11.5px] leading-relaxed max-h-96 overflow-y-auto">
              {file.patch.split("\n").map((line, i) => {
                const type = line.startsWith("@@")
                  ? "header"
                  : line.startsWith("+")
                    ? "add"
                    : line.startsWith("-")
                      ? "remove"
                      : "context";
                return (
                  <div
                    key={i}
                    className="px-3 py-px"
                    style={{
                      background:
                        type === "add"
                          ? "rgba(21, 128, 61, 0.08)"
                          : type === "remove"
                            ? "rgba(185, 28, 28, 0.06)"
                            : "transparent",
                      color:
                        type === "add"
                          ? "var(--chart-5)"
                          : type === "remove"
                            ? "var(--destructive)"
                            : type === "header"
                              ? "var(--primary)"
                              : "var(--muted-foreground)",
                      fontWeight: type === "header" ? 500 : 400,
                    }}
                  >
                    {line || " "}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-3 text-[11.5px] text-muted-foreground">
              No patch available (binary file or too large).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
