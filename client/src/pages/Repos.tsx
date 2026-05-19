import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useSocket } from "../hooks/useSocket";
import { useAuth } from "../context/AuthContext";
import {
  Plus,
  Search,
  Loader2,
  Trash2,
  AlertCircle,
  Lock,
  Globe,
  Star,
  X,
  RefreshCw,
  ChevronDown,
  ExternalLink,
  AlertTriangle,
  FileCode2,
  BookOpen,
  History,
  ChevronRight,
  Activity,
} from "lucide-react";
import api from "../api/axios";

interface AvailableRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  isPrivate: boolean;
  description: string | null;
  language: string | null;
  stars: number;
  updatedAt: string;
  connected: boolean;
}

interface RepoSettings {
  autoIndex: boolean;
  aiProvider?: string;
  aiModel?: string;
}

interface ConnectedRepo {
  _id: string;
  owner: string;
  name: string;
  fullName: string;
  githubRepoId: number;
  isPublic?: boolean;
  settings: RepoSettings;
  isActive: boolean;
  createdAt: string;
}

interface ContextDetail {
  indexStatus: string;
  files: string[];
  conventions: string[];
  prSummaries: string[];
  lastIndexedAt: string | null;
}

type CtxStatus = {
  indexStatus: string;
  lastIndexedAt: string | null;
  fileCount: number;
  conventionCount: number;
  historyCount: number;
};

export default function Repos() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [connectedRepos, setConnectedRepos] = useState<ConnectedRepo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [availableRepos, setAvailableRepos] = useState<AvailableRepo[]>([]);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [connecting, setConnecting] = useState<number | null>(null);
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [updatingSettings, setUpdatingSettings] = useState<string | null>(null);
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installUrl, setInstallUrl] = useState<string | null>(null);
  const [indexing, setIndexing] = useState<string | null>(null);
  const [contextStatus, setContextStatus] = useState<Record<string, CtxStatus>>({});
  const [liveProgress, setLiveProgress] = useState<
    Record<string, { step: string; progress: number }>
  >({});
  const [contextDetails, setContextDetails] = useState<Record<string, ContextDetail>>({});
  const [loadingDetail, setLoadingDetail] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<
    Record<string, "files" | "conventions" | "history">
  >({});

  // Public repo connect flow
  const [showPublic, setShowPublic] = useState(false);
  const [publicInput, setPublicInput] = useState("");
  const [connectingPublic, setConnectingPublic] = useState(false);

  const { on, connected } = useSocket(user?._id);

  // GitHub App installation_id callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const instId = params.get("installation_id");
    if (instId) {
      api
        .post("/auth/installation", { installationId: parseInt(instId, 10) })
        .then(() => {
          window.history.replaceState({}, "", window.location.pathname);
        })
        .catch(() => {});
    }
  }, []);

  const fetchConnected = useCallback(async () => {
    try {
      const { data } = await api.get("/repos");
      setConnectedRepos(data.repos);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConnected();
  }, [fetchConnected]);

  const fetchContextStatus = useCallback(async () => {
    try {
      const { data } = await api.get("/repos/context-status");
      setContextStatus(data.contexts || {});
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchContextStatus();
  }, [fetchContextStatus]);

  useEffect(() => {
    if (connectedRepos.length > 0) fetchContextStatus();
  }, [connectedRepos, fetchContextStatus]);

  // After socket reconnect (server restart / deploy), resync state.
  const prevConnected = useRef(connected);
  useEffect(() => {
    if (connected && !prevConnected.current) {
      fetchContextStatus();
      setLiveProgress({});
      setIndexing(null);
    }
    prevConnected.current = connected;
  }, [connected, fetchContextStatus]);

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    cleanups.push(
      on("context:started", (data: { repoId: string }) => {
        setLiveProgress((p) => ({
          ...p,
          [data.repoId]: { step: "indexer", progress: 5 },
        }));
        setContextStatus((p) => ({
          ...p,
          [data.repoId]: {
            ...p[data.repoId],
            indexStatus: "indexing",
            fileCount: 0,
            conventionCount: 0,
            historyCount: 0,
            lastIndexedAt: null,
          },
        }));
      }),
    );

    cleanups.push(
      on(
        "context:progress",
        (data: { repoId: string; step: string; progress: number }) => {
          setLiveProgress((p) => ({
            ...p,
            [data.repoId]: { step: data.step, progress: data.progress },
          }));
        },
      ),
    );

    cleanups.push(
      on(
        "context:completed",
        (data: {
          repoId: string;
          fileCount: number;
          conventionCount: number;
          historyCount: number;
        }) => {
          setLiveProgress((p) => {
            const n = { ...p };
            delete n[data.repoId];
            return n;
          });
          setContextStatus((p) => ({
            ...p,
            [data.repoId]: {
              indexStatus: "ready",
              lastIndexedAt: new Date().toISOString(),
              fileCount: data.fileCount,
              conventionCount: data.conventionCount,
              historyCount: data.historyCount,
            },
          }));
          setIndexing(null);
          setContextDetails((p) => {
            const n = { ...p };
            delete n[data.repoId];
            return n;
          });
        },
      ),
    );

    cleanups.push(
      on("context:failed", (data: { repoId: string }) => {
        setLiveProgress((p) => {
          const n = { ...p };
          delete n[data.repoId];
          return n;
        });
        setContextStatus((p) => ({
          ...p,
          [data.repoId]: { ...p[data.repoId], indexStatus: "failed" },
        }));
        setIndexing(null);
      }),
    );

    return () => cleanups.forEach((c) => c());
  }, [on]);

  const fetchAvailable = async () => {
    setLoadingAvailable(true);
    setError(null);
    setInstallUrl(null);
    try {
      const { data } = await api.get("/repos/available");
      setAvailableRepos(data.repos);
    } catch (err: any) {
      const e = err.response?.data;
      if (e?.needsInstall) {
        setInstallUrl(e.installUrl);
        setError(e.error);
      } else {
        setError(e?.error || "Failed to fetch repositories");
      }
    } finally {
      setLoadingAvailable(false);
    }
  };

  const fetchContextDetail = async (repoId: string) => {
    if (contextDetails[repoId]) return;
    setLoadingDetail(repoId);
    try {
      const { data } = await api.get(`/repos/${repoId}/context-detail`);
      setContextDetails((p) => ({ ...p, [repoId]: data }));
    } catch {
      /* ignore */
    } finally {
      setLoadingDetail(null);
    }
  };

  const handleConnectPublic = async () => {
    const input = publicInput.trim();
    if (!input) return;
    setConnectingPublic(true);
    setError(null);
    try {
      const { data } = await api.post("/repos/connect-public", {
        fullName: input,
      });
      setConnectedRepos((prev) => [data.repo, ...prev]);
      setPublicInput("");
      setShowPublic(false);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to connect public repo");
    } finally {
      setConnectingPublic(false);
    }
  };

  const handleConnect = async (repo: AvailableRepo) => {
    setConnecting(repo.id);
    try {
      await api.post("/repos/connect", {
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
        githubRepoId: repo.id,
      });
      await fetchConnected();
      setAvailableRepos((prev) =>
        prev.map((r) => (r.id === repo.id ? { ...r, connected: true } : r)),
      );
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to connect repository");
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (repoId: string) => {
    setDisconnecting(repoId);
    try {
      await api.delete(`/repos/${repoId}`);
      setConnectedRepos((prev) => prev.filter((r) => r._id !== repoId));
      const disconnected = connectedRepos.find((r) => r._id === repoId);
      if (disconnected) {
        setAvailableRepos((prev) =>
          prev.map((r) =>
            r.id === disconnected.githubRepoId ? { ...r, connected: false } : r,
          ),
        );
      }
    } catch {
      /* ignore */
    } finally {
      setDisconnecting(null);
    }
  };

  const handleToggleAutoIndex = async (repoId: string, current: boolean) => {
    setUpdatingSettings(repoId);
    try {
      const { data } = await api.patch(`/repos/${repoId}/settings`, {
        autoIndex: !current,
      });
      setConnectedRepos((prev) =>
        prev.map((r) =>
          r._id === repoId ? { ...r, settings: data.repo.settings } : r,
        ),
      );
    } catch {
      /* ignore */
    } finally {
      setUpdatingSettings(null);
    }
  };

  const handleIndexRepo = async (repoId: string) => {
    setIndexing(repoId);
    try {
      await api.post(`/repos/${repoId}/index`);
      setContextStatus((prev) => ({
        ...prev,
        [repoId]: {
          ...prev[repoId],
          indexStatus: "indexing",
          fileCount: 0,
          conventionCount: 0,
          historyCount: 0,
          lastIndexedAt: null,
        },
      }));
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to trigger indexing");
    } finally {
      setIndexing(null);
    }
  };

  const filteredAvailable = availableRepos.filter(
    (r) =>
      !r.connected &&
      r.fullName.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  if (loading) {
    return (
      <div>
        <PageHeader
          onConnect={() => {
            setShowConnect(true);
            fetchAvailable();
          }}
          showConnect={showConnect}
          showPublic={showPublic}
          onPublic={() => setShowPublic(!showPublic)}
        />
        <div className="clay-card p-6 h-40 animate-pulse" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        onConnect={() => {
          setShowConnect(!showConnect);
          if (showPublic) setShowPublic(false);
          if (!showConnect && availableRepos.length === 0) fetchAvailable();
        }}
        showConnect={showConnect}
        showPublic={showPublic}
        onPublic={() => {
          setShowPublic(!showPublic);
          if (showConnect) setShowConnect(false);
        }}
      />

      {error && (
        <div className="mb-6 px-4 py-3 border border-destructive/30 bg-destructive/[0.04] rounded-md flex items-start gap-3">
          <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] text-destructive break-words">{error}</p>
            {installUrl && (
              <a
                href={installUrl}
                className="clay-btn mt-3 inline-flex px-3 py-1.5 text-[12px] items-center gap-1.5"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Install GitHub App
              </a>
            )}
          </div>
          <button
            onClick={() => {
              setError(null);
              setInstallUrl(null);
            }}
            className="text-muted-foreground hover:text-foreground shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Public-repo input panel */}
      {showPublic && (
        <div className="clay-card p-5 mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <p className="text-[13px] font-medium">Add a public repository</p>
            <p className="text-[11px] text-muted-foreground">
              No App installation needed
            </p>
          </div>
          <p className="text-[12px] text-muted-foreground mb-3 leading-relaxed">
            Paste a GitHub URL or <span className="font-mono">owner/repo</span>.
            Strata will index it on demand using your GitHub identity. Public
            repos don't get webhook updates &mdash; you re-index manually.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleConnectPublic();
            }}
            className="flex items-center gap-2"
          >
            <div className="flex-1 flex items-center gap-2 border border-border rounded-md px-2.5 bg-card">
              <Globe className="w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                value={publicInput}
                onChange={(e) => setPublicInput(e.target.value)}
                placeholder="facebook/react  or  https://github.com/facebook/react"
                disabled={connectingPublic}
                autoFocus
                className="flex-1 bg-transparent py-2 text-[13px] font-mono outline-none placeholder:text-muted-foreground/50 disabled:opacity-60"
              />
            </div>
            <button
              type="submit"
              disabled={connectingPublic || !publicInput.trim()}
              className="clay-btn clay-btn-primary px-3 py-2 text-[12.5px] flex items-center gap-1.5 disabled:opacity-60"
            >
              {connectingPublic ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Plus className="w-3.5 h-3.5" />
              )}
              {connectingPublic ? "Adding…" : "Add"}
            </button>
          </form>
        </div>
      )}

      {/* Available repos panel */}
      {showConnect && (
        <div className="clay-card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px] font-medium">Available repositories</p>
            <button
              onClick={fetchAvailable}
              disabled={loadingAvailable}
              className="clay-btn clay-btn-ghost px-2.5 py-1 text-[12px] flex items-center gap-1.5"
            >
              <RefreshCw
                className={`w-3 h-3 ${loadingAvailable ? "animate-spin" : ""}`}
              />
              Refresh
            </button>
          </div>

          <div className="flex items-center gap-2 mb-4 border border-border rounded-md px-2.5 bg-card">
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search repositories…"
              className="flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-muted-foreground/50"
            />
          </div>

          {loadingAvailable ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
              <p className="text-[12px] text-muted-foreground ml-2">
                Fetching your repos from GitHub…
              </p>
            </div>
          ) : filteredAvailable.length === 0 ? (
            <p className="text-center py-8 text-[12px] text-muted-foreground">
              {availableRepos.length === 0
                ? "No repositories found. Make sure the GitHub App is installed on your account."
                : "No matching repositories."}
            </p>
          ) : (
            <ul className="divide-y divide-border border-t border-border max-h-96 overflow-y-auto">
              {filteredAvailable.map((repo) => (
                <li
                  key={repo.id}
                  className="flex items-center justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      {repo.isPrivate ? (
                        <Lock className="w-3 h-3 text-muted-foreground shrink-0" />
                      ) : (
                        <Globe className="w-3 h-3 text-muted-foreground shrink-0" />
                      )}
                      <p className="text-[13px] font-medium truncate">
                        {repo.fullName}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[11px] text-muted-foreground">
                      {repo.language && <span>{repo.language}</span>}
                      {repo.stars > 0 && (
                        <span className="flex items-center gap-0.5 tabular-nums">
                          <Star className="w-2.5 h-2.5" />
                          {repo.stars}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleConnect(repo)}
                    disabled={connecting === repo.id}
                    className="clay-btn px-3 py-1.5 text-[12px] flex items-center gap-1.5 shrink-0"
                  >
                    {connecting === repo.id ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Plus className="w-3 h-3" />
                    )}
                    Connect
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Connected repos */}
      {connectedRepos.length > 0 ? (
        <div className="space-y-3">
          <p className="text-[11px] uppercase tracking-[0.08em] font-medium text-muted-foreground">
            Connected · {connectedRepos.length}
          </p>
          {connectedRepos.map((repo) => {
            const isExpanded = expandedRepo === repo._id;
            const isUpdating = updatingSettings === repo._id;
            const ctx = contextStatus[repo._id];
            const detail = contextDetails[repo._id];
            const activeTab = detailTab[repo._id] || "files";

            return (
              <div key={repo._id} className="clay-card p-5">
                {/* Row 1: name + actions */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-[14px] font-medium truncate">
                        {repo.fullName}
                      </p>
                      {repo.isPublic && (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border border-border"
                          title="Public repo · manual re-index only"
                        >
                          <Globe className="w-2.5 h-2.5" />
                          Public
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1">
                      {repo.isPublic ? (
                        <span className="text-[11px] inline-flex items-center gap-1 text-muted-foreground">
                          <RefreshCw className="w-2.5 h-2.5" />
                          Manual re-index
                        </span>
                      ) : (
                        <span
                          className="text-[11px] inline-flex items-center gap-1"
                          style={{
                            color: repo.settings.autoIndex
                              ? "var(--chart-5)"
                              : "var(--muted-foreground)",
                          }}
                        >
                          <Activity className="w-2.5 h-2.5" />
                          {repo.settings.autoIndex
                            ? "Auto-index on"
                            : "Auto-index off"}
                        </span>
                      )}
                      <ContextBadge
                        status={ctx?.indexStatus}
                        fileCount={ctx?.fileCount}
                        isLive={!!liveProgress[repo._id]}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <a
                      href={`https://github.com/${repo.fullName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="clay-btn clay-btn-ghost p-1.5"
                      title="Open on GitHub"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      onClick={() => navigate(`/dashboard?repoId=${repo._id}`)}
                      className="clay-btn clay-btn-ghost p-1.5"
                      title="View health"
                    >
                      <Activity className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        const next = isExpanded ? null : repo._id;
                        setExpandedRepo(next);
                        if (next && ctx?.indexStatus === "ready") {
                          fetchContextDetail(repo._id);
                        }
                      }}
                      className="clay-btn clay-btn-ghost p-1.5"
                    >
                      <ChevronDown
                        className={`w-3.5 h-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      />
                    </button>
                    <button
                      onClick={() => handleDisconnect(repo._id)}
                      disabled={disconnecting === repo._id}
                      className="clay-btn clay-btn-ghost p-1.5 text-destructive/70 hover:text-destructive"
                    >
                      {disconnecting === repo._id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Expanded panel */}
                {isExpanded && (
                  <div className="mt-5 pt-5 border-t border-border space-y-4">
                    {/* Auto-index — hidden for public repos (no webhooks) */}
                    {repo.isPublic ? (
                      <div className="flex items-start gap-2.5 text-[11.5px] text-muted-foreground">
                        <Globe className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <p className="leading-relaxed">
                          Public repos don't receive webhook events, so
                          Strata can't auto-reindex them. Click{" "}
                          <span className="text-foreground">Re-index</span>{" "}
                          below whenever you want a fresh snapshot.
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[13px] font-medium">
                            Auto-index on push
                          </p>
                          <p className="text-[11.5px] text-muted-foreground mt-0.5">
                            Re-index automatically when commits land on the
                            default branch.
                          </p>
                        </div>
                        <button
                          onClick={() =>
                            handleToggleAutoIndex(repo._id, repo.settings.autoIndex)
                          }
                          disabled={isUpdating}
                          className="relative w-9 h-5 rounded-full transition-colors shrink-0"
                          style={{
                            background: repo.settings.autoIndex
                              ? "var(--primary)"
                              : "var(--border)",
                          }}
                        >
                          <span
                            className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                            style={{
                              transform: repo.settings.autoIndex
                                ? "translateX(16px)"
                                : "translateX(0)",
                            }}
                          />
                        </button>
                      </div>
                    )}

                    {/* Context status */}
                    <div className="border border-border rounded-md p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[12.5px] font-medium">
                          Codebase index
                        </p>
                        <StatusPill
                          status={ctx?.indexStatus}
                          isLive={!!liveProgress[repo._id]}
                        />
                      </div>

                      {(ctx?.indexStatus === "indexing" ||
                        liveProgress[repo._id]) && (
                        <p className="text-[11.5px] text-muted-foreground mb-3">
                          Indexing might take a while depending on repo size.
                          You can safely navigate away.
                        </p>
                      )}

                      {ctx?.indexStatus === "ready" && ctx && (
                        <div className="grid grid-cols-3 gap-2 mb-3">
                          <StatBlock label="Files" value={ctx.fileCount} />
                          <StatBlock
                            label="Conventions"
                            value={ctx.conventionCount}
                          />
                          <StatBlock
                            label="PR summaries"
                            value={ctx.historyCount}
                          />
                        </div>
                      )}

                      {ctx?.lastIndexedAt && (
                        <p className="text-[10.5px] text-muted-foreground">
                          Last indexed{" "}
                          {new Date(ctx.lastIndexedAt).toLocaleString()}
                        </p>
                      )}

                      {(!ctx || ctx.indexStatus === "idle") && (
                        <p className="text-[11.5px] text-muted-foreground">
                          Click <span className="text-foreground">Index codebase</span>{" "}
                          to parse this repo with tree-sitter and compute its
                          first health score.
                        </p>
                      )}

                      {ctx?.indexStatus === "failed" && (
                        <p className="text-[11.5px] text-destructive">
                          Indexing failed. Check server logs and try again.
                        </p>
                      )}
                    </div>

                    {/* Detail tabs */}
                    {ctx?.indexStatus === "ready" && (
                      <div className="border border-border rounded-md p-4">
                        <div className="flex items-center gap-1 mb-3">
                          {(
                            [
                              {
                                id: "files" as const,
                                label: "Indexed files",
                                icon: FileCode2,
                                count: ctx.fileCount,
                              },
                              {
                                id: "conventions" as const,
                                label: "Conventions",
                                icon: BookOpen,
                                count: ctx.conventionCount,
                              },
                              {
                                id: "history" as const,
                                label: "PR summaries",
                                icon: History,
                                count: ctx.historyCount,
                              },
                            ] as const
                          ).map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                              <button
                                key={tab.id}
                                onClick={() => {
                                  setDetailTab((p) => ({
                                    ...p,
                                    [repo._id]: tab.id,
                                  }));
                                  fetchContextDetail(repo._id);
                                }}
                                className={`flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] rounded-md transition-colors ${
                                  isActive
                                    ? "bg-muted text-foreground font-medium"
                                    : "text-muted-foreground hover:text-foreground"
                                }`}
                              >
                                <tab.icon className="w-3 h-3" />
                                {tab.label}
                                {tab.count > 0 && (
                                  <span className="text-[10.5px] tabular-nums text-muted-foreground">
                                    {tab.count}
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>

                        {loadingDetail === repo._id ? (
                          <div className="flex items-center justify-center py-6">
                            <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
                          </div>
                        ) : detail ? (
                          <>
                            {activeTab === "files" && <FilesList files={detail.files} />}
                            {activeTab === "conventions" && (
                              <ConventionsList conventions={detail.conventions} />
                            )}
                            {activeTab === "history" && (
                              <PRSummariesList summaries={detail.prSummaries} />
                            )}
                          </>
                        ) : (
                          <p className="text-[11.5px] text-muted-foreground text-center py-4">
                            Click a tab to load details
                          </p>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleIndexRepo(repo._id)}
                        disabled={
                          indexing === repo._id || ctx?.indexStatus === "indexing"
                        }
                        className="clay-btn clay-btn-primary px-3 py-2 text-[12.5px] flex items-center gap-1.5 flex-1 justify-center"
                      >
                        {indexing === repo._id ||
                        ctx?.indexStatus === "indexing" ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Activity className="w-3.5 h-3.5" />
                        )}
                        {indexing === repo._id ||
                        ctx?.indexStatus === "indexing"
                          ? "Indexing…"
                          : "Index codebase"}
                      </button>
                      <button
                        onClick={() => navigate(`/dashboard?repoId=${repo._id}`)}
                        className="clay-btn px-3 py-2 text-[12.5px] flex items-center gap-1.5 flex-1 justify-center"
                      >
                        <Activity className="w-3.5 h-3.5" />
                        View health
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : !showConnect ? (
        <div className="clay-card p-10 flex flex-col items-center text-center">
          <div className="w-10 h-10 rounded-md border border-border flex items-center justify-center mb-5">
            <div className="w-4 h-4 border border-muted-foreground/40 rounded-sm" />
          </div>
          <h2 className="text-[15px] font-semibold">No repos connected</h2>
          <p className="mt-2 text-[12.5px] text-muted-foreground max-w-sm">
            Connect a repository and Strata will index it on the next push and
            start tracking its structural health.
          </p>
          <button
            onClick={() => {
              setShowConnect(true);
              if (availableRepos.length === 0) fetchAvailable();
            }}
            className="mt-5 clay-btn clay-btn-primary px-4 py-2 text-[12.5px] flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Connect repository
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* ── Small helpers ─────────────────────────────────────────────── */

function PageHeader({
  showConnect,
  onConnect,
  showPublic,
  onPublic,
}: {
  showConnect: boolean;
  onConnect: () => void;
  showPublic: boolean;
  onPublic: () => void;
}) {
  return (
    <div className="flex items-end justify-between gap-4 mb-8 pb-6 border-b border-border">
      <div>
        <p className="text-[11px] uppercase tracking-[0.1em] font-medium text-muted-foreground mb-2">
          Repositories
        </p>
        <h1 className="text-[28px] font-semibold tracking-tight leading-none">
          Connected repos
        </h1>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onPublic}
          className="clay-btn px-3 py-2 text-[12.5px] flex items-center gap-1.5"
        >
          {showPublic ? (
            <X className="w-3.5 h-3.5" />
          ) : (
            <Globe className="w-3.5 h-3.5" />
          )}
          {showPublic ? "Close" : "Add public repo"}
        </button>
        <button
          onClick={onConnect}
          className="clay-btn clay-btn-primary px-3 py-2 text-[12.5px] flex items-center gap-1.5"
        >
          {showConnect ? (
            <X className="w-3.5 h-3.5" />
          ) : (
            <Plus className="w-3.5 h-3.5" />
          )}
          {showConnect ? "Close" : "Connect repo"}
        </button>
      </div>
    </div>
  );
}

function ContextBadge({
  status,
  fileCount,
  isLive,
}: {
  status?: string;
  fileCount?: number;
  isLive: boolean;
}) {
  if (isLive || status === "indexing") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        Indexing
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span
        className="inline-flex items-center gap-1 text-[11px]"
        style={{ color: "var(--chart-5)" }}
      >
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--chart-5)" }} />
        {fileCount} files indexed
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-destructive">
        <AlertTriangle className="w-2.5 h-2.5" />
        Index failed
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
      <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
      Not indexed
    </span>
  );
}

function StatusPill({
  status,
  isLive,
}: {
  status?: string;
  isLive: boolean;
}) {
  if (isLive || status === "indexing") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium"
        style={{
          color: "var(--chart-3)",
          background: "rgba(161, 98, 7, 0.08)",
        }}
      >
        <Loader2 className="w-2.5 h-2.5 animate-spin" />
        Indexing
      </span>
    );
  }
  if (status === "ready") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium"
        style={{
          color: "var(--chart-5)",
          background: "rgba(21, 128, 61, 0.08)",
        }}
      >
        Ready
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10.5px] font-medium"
        style={{
          color: "var(--destructive)",
          background: "rgba(185, 28, 28, 0.06)",
        }}
      >
        Failed
      </span>
    );
  }
  return null;
}

function StatBlock({ label, value }: { label: string; value: number }) {
  return (
    <div className="text-center py-2">
      <p className="text-[18px] font-semibold tabular-nums leading-none">
        {value}
      </p>
      <p className="text-[10.5px] text-muted-foreground mt-1.5">{label}</p>
    </div>
  );
}

function FilesList({ files }: { files: string[] }) {
  const [showAll, setShowAll] = useState(false);
  const displayed = showAll ? files : files.slice(0, 50);

  if (files.length === 0) {
    return (
      <p className="text-[11.5px] text-muted-foreground text-center py-4">
        No files indexed yet.
      </p>
    );
  }

  const grouped: Record<string, string[]> = {};
  for (const f of displayed) {
    const parts = f.split("/");
    const dir = parts.length > 1 ? parts[0] : ".";
    if (!grouped[dir]) grouped[dir] = [];
    grouped[dir].push(f);
  }

  return (
    <div>
      <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
        {Object.entries(grouped)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([dir, dirFiles]) => (
            <div key={dir}>
              <p className="text-[10.5px] font-medium text-muted-foreground mb-1">
                {dir}/
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-0.5 ml-2">
                {dirFiles.map((f) => (
                  <p
                    key={f}
                    className="text-[11px] text-foreground font-mono truncate"
                    title={f}
                  >
                    {f}
                  </p>
                ))}
              </div>
            </div>
          ))}
      </div>
      {files.length > 50 && !showAll && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 text-[11.5px] text-primary hover:underline flex items-center gap-1"
        >
          <ChevronRight className="w-3 h-3" />
          Show all {files.length} files
        </button>
      )}
      {showAll && files.length > 50 && (
        <button
          onClick={() => setShowAll(false)}
          className="mt-3 text-[11.5px] text-primary hover:underline"
        >
          Show less
        </button>
      )}
    </div>
  );
}

function ConventionsList({ conventions }: { conventions: string[] }) {
  if (conventions.length === 0) {
    return (
      <p className="text-[11.5px] text-muted-foreground text-center py-4">
        No conventions detected yet. Add an AI provider in Settings and re-index.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border border-t border-border max-h-72 overflow-y-auto">
      {conventions.map((c, i) => (
        <li key={i} className="py-2 text-[12px] text-foreground leading-snug">
          {c}
        </li>
      ))}
    </ul>
  );
}

function PRSummariesList({ summaries }: { summaries: string[] }) {
  if (summaries.length === 0) {
    return (
      <p className="text-[11.5px] text-muted-foreground text-center py-4">
        No PR summaries saved yet. Add an AI provider in Settings and re-index.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border border-t border-border max-h-72 overflow-y-auto">
      {summaries.map((s, i) => (
        <li key={i} className="py-2 text-[12px] text-foreground leading-snug">
          {s}
        </li>
      ))}
    </ul>
  );
}
