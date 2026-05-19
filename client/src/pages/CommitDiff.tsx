import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText, ZoomIn, ZoomOut, Plus, Minus, Loader2 } from "lucide-react";
import axios from "../api/axios";

interface FileDiff {
  filename: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface CommitData {
  commitSha: string;
  files: string[];
  pushedAt: string;
  fileDiffs: FileDiff[];
}

/**
 * Full-page commit diff viewer. File tree on the left, diff on the right
 * with line numbers. Editorial light theme — GitHub-style add/remove tints
 * on a near-white background.
 */
export default function CommitDiff() {
  const { repoId, commitSha } = useParams<{
    repoId: string;
    commitSha: string;
  }>();
  const navigate = useNavigate();
  const [commit, setCommit] = useState<CommitData | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontSize, setFontSize] = useState(12);

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await axios.get(`/health/${repoId}/commit/${commitSha}`);
        const commitData =
          res.data.commit ||
          res.data.recentPushes?.find(
            (p: CommitData) => p.commitSha === commitSha,
          );
        if (commitData) {
          setCommit(commitData);
          if (commitData.fileDiffs?.length > 0) {
            setSelectedFile(commitData.fileDiffs[0].filename);
          }
        }
      } catch (err) {
        console.error("Failed to fetch commit data:", err);
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [repoId, commitSha]);

  const parsePatch = (patch: string) => {
    const result: Array<{
      type: "add" | "remove" | "context" | "header";
      content: string;
      oldLine?: number;
      newLine?: number;
    }> = [];

    let oldLine = 1;
    let newLine = 1;
    for (const line of patch.split("\n")) {
      if (line.startsWith("@@")) {
        const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
        if (match) {
          oldLine = parseInt(match[1]);
          newLine = parseInt(match[2]);
        }
        result.push({ type: "header", content: line });
      } else if (line.startsWith("+")) {
        result.push({ type: "add", content: line.slice(1), newLine: newLine++ });
      } else if (line.startsWith("-")) {
        result.push({ type: "remove", content: line.slice(1), oldLine: oldLine++ });
      } else if (line.startsWith(" ")) {
        result.push({
          type: "context",
          content: line.slice(1),
          oldLine: oldLine++,
          newLine: newLine++,
        });
      } else {
        result.push({
          type: "context",
          content: line,
          oldLine: oldLine++,
          newLine: newLine++,
        });
      }
    }
    return result;
  };

  const selectedFileDiff = commit?.fileDiffs.find((f) => f.filename === selectedFile);
  const backToHealth = () => {
    if (repoId && /^[a-f0-9]{24}$/i.test(repoId)) {
      navigate(`/dashboard?repoId=${repoId}`);
    } else {
      navigate("/dashboard/repos");
    }
  };

  if (loading) {
    return (
      <div>
        <div className="mb-8 pb-6 border-b border-border">
          <button
            onClick={backToHealth}
            className="clay-btn clay-btn-ghost px-2 py-1 text-[12px] flex items-center gap-1.5 mb-3 -ml-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to health
          </button>
          <h1 className="text-[20px] font-semibold tracking-tight">Commit</h1>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-4 h-4 text-muted-foreground animate-spin" />
          <span className="ml-2 text-[12.5px] text-muted-foreground">
            Loading commit…
          </span>
        </div>
      </div>
    );
  }

  if (!commit) {
    return (
      <div>
        <div className="mb-8 pb-6 border-b border-border">
          <button
            onClick={backToHealth}
            className="clay-btn clay-btn-ghost px-2 py-1 text-[12px] flex items-center gap-1.5 mb-3 -ml-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to health
          </button>
          <h1 className="text-[20px] font-semibold tracking-tight">Commit not found</h1>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-6 pb-5 border-b border-border">
        <button
          onClick={backToHealth}
          className="clay-btn clay-btn-ghost px-2 py-1 text-[12px] flex items-center gap-1.5 mb-3 -ml-2"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to health
        </button>
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.1em] font-medium text-muted-foreground mb-1">
              Commit
            </p>
            <h1 className="text-[22px] font-mono font-medium tabular-nums">
              {commitSha?.slice(0, 12)}
            </h1>
            <p className="text-[11.5px] text-muted-foreground mt-1">
              {new Date(commit.pushedAt).toLocaleString()}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setFontSize((s) => Math.max(s - 2, 8))}
              className="clay-btn clay-btn-ghost p-1.5"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] text-muted-foreground font-mono tabular-nums min-w-[2.5rem] text-center">
              {fontSize}px
            </span>
            <button
              onClick={() => setFontSize((s) => Math.min(s + 2, 24))}
              className="clay-btn clay-btn-ghost p-1.5"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* File tree + diff */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-4">
        {/* File tree */}
        <div className="clay-card p-3">
          <p className="text-[11px] uppercase tracking-[0.06em] font-medium text-muted-foreground mb-2 px-1">
            Changed files · {commit.fileDiffs.length}
          </p>
          <div className="max-h-[600px] overflow-y-auto">
            {commit.fileDiffs.map((file) => {
              const isActive = selectedFile === file.filename;
              const name = file.filename.split("/").pop();
              const path = file.filename.includes("/")
                ? file.filename.split("/").slice(0, -1).join("/")
                : "";
              return (
                <button
                  key={file.filename}
                  onClick={() => setSelectedFile(file.filename)}
                  className={`w-full text-left px-2 py-1.5 rounded-md transition-colors mb-0.5 ${
                    isActive
                      ? "bg-muted text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <FileText className="w-3 h-3 shrink-0" />
                    <span className="text-[12px] font-mono truncate">{name}</span>
                  </div>
                  {path && (
                    <p className="text-[10.5px] text-muted-foreground truncate ml-4.5 mt-0.5">
                      {path}/
                    </p>
                  )}
                  <div className="flex items-center gap-2 ml-4.5 mt-1">
                    {file.additions > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10.5px] tabular-nums"
                        style={{ color: "var(--chart-5)" }}
                      >
                        <Plus className="w-2 h-2" />
                        {file.additions}
                      </span>
                    )}
                    {file.deletions > 0 && (
                      <span
                        className="inline-flex items-center gap-0.5 text-[10.5px] tabular-nums"
                        style={{ color: "var(--destructive)" }}
                      >
                        <Minus className="w-2 h-2" />
                        {file.deletions}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Diff */}
        <div className="clay-card overflow-hidden">
          {selectedFileDiff ? (
            <>
              <div className="px-4 py-3 border-b border-border flex items-center gap-2">
                <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-[12.5px] font-mono">
                  {selectedFileDiff.filename}
                </span>
                <div className="ml-auto flex items-center gap-3">
                  <span
                    className="text-[11px] tabular-nums"
                    style={{ color: "var(--chart-5)" }}
                  >
                    +{selectedFileDiff.additions}
                  </span>
                  <span
                    className="text-[11px] tabular-nums"
                    style={{ color: "var(--destructive)" }}
                  >
                    −{selectedFileDiff.deletions}
                  </span>
                </div>
              </div>
              {selectedFileDiff.patch ? (
                <div className="overflow-auto max-h-[calc(100vh-260px)]">
                  <div
                    className="font-mono leading-relaxed"
                    style={{ fontSize: `${fontSize}px` }}
                  >
                    {parsePatch(selectedFileDiff.patch).map((line, idx) => (
                      <div
                        key={idx}
                        className="flex"
                        style={{
                          background:
                            line.type === "add"
                              ? "rgba(21, 128, 61, 0.06)"
                              : line.type === "remove"
                                ? "rgba(185, 28, 28, 0.05)"
                                : line.type === "header"
                                  ? "var(--muted)"
                                  : "transparent",
                        }}
                      >
                        <div className="flex shrink-0 select-none">
                          <div className="w-12 text-right px-2 py-0.5 text-muted-foreground tabular-nums border-r border-border">
                            {line.oldLine ?? ""}
                          </div>
                          <div className="w-12 text-right px-2 py-0.5 text-muted-foreground tabular-nums border-r border-border">
                            {line.newLine ?? ""}
                          </div>
                        </div>
                        <div
                          className="w-6 px-1 py-0.5 text-center select-none shrink-0"
                          style={{
                            color:
                              line.type === "add"
                                ? "var(--chart-5)"
                                : line.type === "remove"
                                  ? "var(--destructive)"
                                  : "transparent",
                          }}
                        >
                          {line.type === "add" ? "+" : line.type === "remove" ? "−" : " "}
                        </div>
                        <div
                          className="flex-1 px-2 py-0.5 whitespace-pre"
                          style={{
                            color:
                              line.type === "add"
                                ? "var(--chart-5)"
                                : line.type === "remove"
                                  ? "var(--destructive)"
                                  : line.type === "header"
                                    ? "var(--primary)"
                                    : "var(--foreground)",
                            fontWeight: line.type === "header" ? 500 : 400,
                          }}
                        >
                          {line.content}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-10 text-center text-[12.5px] text-muted-foreground">
                  No diff data available for this file.
                </div>
              )}
            </>
          ) : (
            <div className="p-10 text-center text-[12.5px] text-muted-foreground">
              Select a file to view changes.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
