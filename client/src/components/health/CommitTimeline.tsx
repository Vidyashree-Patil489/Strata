import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  GitCommit,
  FileCode,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  ExternalLink,
} from "lucide-react";

interface Push {
  commitSha: string;
  files: string[];
  pushedAt: string;
  fileDiffs: Array<{
    filename: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

interface Props {
  pushes: Push[];
  repoId: string;
}

/**
 * Recent-push timeline. Each entry shows the commit SHA, time, total diff
 * counts, and changed files as inline pills. Clicking "View inline"
 * expands a per-file diff preview. "View changes" navigates to the
 * dedicated full-screen diff page.
 */
export function CommitTimeline({ pushes, repoId }: Props) {
  const navigate = useNavigate();
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

  if (pushes.length === 0) return null;

  const formatTime = (date: string) => {
    const d = new Date(date);
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const toggleCommit = (sha: string) => {
    setExpandedCommit(expandedCommit === sha ? null : sha);
    setExpandedFiles(new Set());
  };

  const toggleFile = (filename: string) => {
    const next = new Set(expandedFiles);
    next.has(filename) ? next.delete(filename) : next.add(filename);
    setExpandedFiles(next);
  };

  const parsePatch = (patch: string) => {
    const result: Array<{
      type: "add" | "remove" | "context" | "header";
      content: string;
    }> = [];
    for (const line of patch.split("\n")) {
      if (line.startsWith("@@")) result.push({ type: "header", content: line });
      else if (line.startsWith("+")) result.push({ type: "add", content: line.slice(1) });
      else if (line.startsWith("-")) result.push({ type: "remove", content: line.slice(1) });
      else result.push({ type: "context", content: line });
    }
    return result;
  };

  return (
    <div className="clay-card p-5">
      <div className="flex items-baseline justify-between mb-4">
        <p className="text-[12px] font-medium">Recent activity</p>
        <p className="text-[11px] text-muted-foreground">{pushes.length} pushes</p>
      </div>

      <ol className="divide-y divide-border border-t border-border">
        {pushes.map((push) => {
          const isExpanded = expandedCommit === push.commitSha;
          const hasDiffs = push.fileDiffs && push.fileDiffs.length > 0;
          const adds =
            push.fileDiffs?.reduce((s, f) => s + (f.additions || 0), 0) || 0;
          const dels =
            push.fileDiffs?.reduce((s, f) => s + (f.deletions || 0), 0) || 0;

          return (
            <li key={push.commitSha} className="py-3">
              <div className="flex items-start gap-3">
                <div className="mt-0.5">
                  <GitCommit className="w-3.5 h-3.5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-mono text-foreground tabular-nums">
                      {push.commitSha.slice(0, 7)}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {formatTime(push.pushedAt)}
                    </span>
                    {hasDiffs && (
                      <div className="flex items-center gap-2 ml-auto">
                        {adds > 0 && (
                          <span className="flex items-center gap-0.5 text-[11px] tabular-nums" style={{ color: "var(--chart-5)" }}>
                            <Plus className="w-2.5 h-2.5" />
                            {adds}
                          </span>
                        )}
                        {dels > 0 && (
                          <span className="flex items-center gap-0.5 text-[11px] tabular-nums" style={{ color: "var(--destructive)" }}>
                            <Minus className="w-2.5 h-2.5" />
                            {dels}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {push.files.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {push.files.slice(0, 5).map((file, j) => (
                        <span
                          key={j}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted text-[10.5px] font-mono text-muted-foreground"
                        >
                          <FileCode className="w-2.5 h-2.5" />
                          {file.split("/").pop()}
                        </span>
                      ))}
                      {push.files.length > 5 && (
                        <span className="text-[10.5px] text-muted-foreground/70 px-1.5 py-0.5">
                          +{push.files.length - 5} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/60 italic mt-1">
                      No file changes tracked
                    </p>
                  )}

                  {hasDiffs && (
                    <div className="flex items-center gap-3 mt-2">
                      <button
                        onClick={() => toggleCommit(push.commitSha)}
                        className="flex items-center gap-1 text-[11px] text-foreground hover:text-primary transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3" />
                        ) : (
                          <ChevronRight className="w-3 h-3" />
                        )}
                        {isExpanded ? "Hide" : "View"} inline
                      </button>
                      <button
                        onClick={() =>
                          navigate(`/dashboard/commit-diff/${repoId}/${push.commitSha}`)
                        }
                        className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
                      >
                        <ExternalLink className="w-3 h-3" />
                        Full diff
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {isExpanded && hasDiffs && (
                <div className="mt-3 pl-6 space-y-1.5">
                  {push.fileDiffs.map((file, j) => {
                    const isFileExpanded = expandedFiles.has(file.filename);
                    const parsedPatch = file.patch ? parsePatch(file.patch) : [];
                    return (
                      <div
                        key={j}
                        className="border border-border rounded-md overflow-hidden"
                      >
                        <button
                          onClick={() => toggleFile(file.filename)}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted transition-colors"
                        >
                          {isFileExpanded ? (
                            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
                          ) : (
                            <ChevronRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          )}
                          <FileCode className="w-3 h-3 text-muted-foreground shrink-0" />
                          <span className="text-[11px] font-mono flex-1 truncate">
                            {file.filename}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            {file.additions > 0 && (
                              <span className="flex items-center gap-0.5 text-[10.5px] tabular-nums" style={{ color: "var(--chart-5)" }}>
                                <Plus className="w-2 h-2" />
                                {file.additions}
                              </span>
                            )}
                            {file.deletions > 0 && (
                              <span className="flex items-center gap-0.5 text-[10.5px] tabular-nums" style={{ color: "var(--destructive)" }}>
                                <Minus className="w-2 h-2" />
                                {file.deletions}
                              </span>
                            )}
                          </div>
                        </button>

                        {isFileExpanded && file.patch && (
                          <div className="border-t border-border bg-muted">
                            <div className="font-mono text-[11px] leading-relaxed max-h-64 overflow-y-auto">
                              {parsedPatch.map((line, k) => (
                                <div
                                  key={k}
                                  className="px-3 py-px"
                                  style={{
                                    background:
                                      line.type === "add"
                                        ? "rgba(21, 128, 61, 0.08)" // chart-5 with low alpha
                                        : line.type === "remove"
                                          ? "rgba(185, 28, 28, 0.06)" // destructive with low alpha
                                          : "transparent",
                                    color:
                                      line.type === "add"
                                        ? "var(--chart-5)"
                                        : line.type === "remove"
                                          ? "var(--destructive)"
                                          : line.type === "header"
                                            ? "var(--primary)"
                                            : "var(--muted-foreground)",
                                    fontWeight:
                                      line.type === "header" ? 500 : 400,
                                  }}
                                >
                                  {line.type === "add" && "+ "}
                                  {line.type === "remove" && "- "}
                                  {line.content}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
