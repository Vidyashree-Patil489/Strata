import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Minus, FileCode } from "lucide-react";

interface FileDiff {
  filename: string;
  additions: number;
  deletions: number;
  patch?: string;
}

interface Props {
  commitSha: string;
  repoFullName: string;
  files: FileDiff[];
}

export function CommitDiffViewer({ commitSha, repoFullName, files }: Props) {
  void commitSha;
  void repoFullName;

  const [expandedFiles, setExpandedFiles] = useState<Set<string>>(new Set());

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

  if (files.length === 0) return null;

  return (
    <div className="clay-card p-5">
      <p className="text-[12px] font-medium mb-4">Code changes</p>

      <div className="space-y-1.5">
        {files.map((file, i) => {
          const isExpanded = expandedFiles.has(file.filename);
          const parsedPatch = file.patch ? parsePatch(file.patch) : [];

          return (
            <div key={i} className="border border-border rounded-md overflow-hidden">
              <button
                onClick={() => toggleFile(file.filename)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-muted transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
                <FileCode className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="text-[12px] font-mono flex-1 truncate">
                  {file.filename}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {file.additions > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] tabular-nums" style={{ color: "var(--chart-5)" }}>
                      <Plus className="w-2.5 h-2.5" />
                      {file.additions}
                    </span>
                  )}
                  {file.deletions > 0 && (
                    <span className="flex items-center gap-0.5 text-[11px] tabular-nums" style={{ color: "var(--destructive)" }}>
                      <Minus className="w-2.5 h-2.5" />
                      {file.deletions}
                    </span>
                  )}
                </div>
              </button>

              {isExpanded && file.patch && (
                <div className="border-t border-border bg-muted">
                  <div className="font-mono text-[11.5px] leading-relaxed max-h-96 overflow-y-auto">
                    {parsedPatch.map((line, j) => (
                      <div
                        key={j}
                        className="px-3 py-px"
                        style={{
                          background:
                            line.type === "add"
                              ? "rgba(21, 128, 61, 0.08)"
                              : line.type === "remove"
                                ? "rgba(185, 28, 28, 0.06)"
                                : "transparent",
                          color:
                            line.type === "add"
                              ? "var(--chart-5)"
                              : line.type === "remove"
                                ? "var(--destructive)"
                                : line.type === "header"
                                  ? "var(--primary)"
                                  : "var(--muted-foreground)",
                          fontWeight: line.type === "header" ? 500 : 400,
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
    </div>
  );
}
