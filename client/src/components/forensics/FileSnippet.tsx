import { useState, useEffect, useRef } from "react";
import { FileCode, Loader2, AlertCircle, ExternalLink, Eye, EyeOff } from "lucide-react";
import api from "../../api/axios";

interface Snippet {
  path: string;
  language: string;
  totalLines: number;
  start: number;
  end: number;
  content: string;
  url: string;
}

interface Props {
  repoId: string;
  path: string;
  /**
   * If true, fetches & renders immediately on mount.
   * If false, renders a collapsed pill that fetches on click.
   * Default: false (expand-on-click) so a page with 30 citations
   * doesn't make 30 GitHub API calls before the user shows interest.
   */
  defaultExpanded?: boolean;
  /** Lines to fetch when expanded. Default 60. */
  previewLines?: number;
}

/**
 * Inline code snippet for cited files. Collapsed by default — click to
 * fetch and expand. Once fetched, content is cached in component state
 * for the lifetime of the page (won't re-fetch on collapse/re-expand).
 *
 * Renders as a monospace block with line numbers. No syntax highlighting
 * library (would bloat the bundle) — the `language` field is recorded
 * for future enhancement.
 */
export function FileSnippet({
  repoId,
  path,
  defaultExpanded = false,
  previewLines = 60,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [snippet, setSnippet] = useState<Snippet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetched = useRef(false);

  useEffect(() => {
    if (!expanded || fetched.current) return;
    fetched.current = true;
    setLoading(true);
    setError(null);
    api
      .get(`/repos/${repoId}/file-snippet`, {
        params: { path, start: 1, end: previewLines },
      })
      .then(({ data }) => setSnippet(data))
      .catch((err) => {
        setError(err.response?.data?.error || err.message || "Fetch failed");
      })
      .finally(() => setLoading(false));
  }, [expanded, repoId, path, previewLines]);

  return (
    <div className="border border-border rounded-md overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/40 border-b border-border">
        <FileCode className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-[12px] font-mono flex-1 truncate">{path}</span>
        {snippet && (
          <a
            href={snippet.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10.5px] text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            GitHub
          </a>
        )}
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10.5px] text-muted-foreground hover:text-foreground flex items-center gap-1 shrink-0"
        >
          {expanded ? (
            <>
              <EyeOff className="w-2.5 h-2.5" />
              Hide
            </>
          ) : (
            <>
              <Eye className="w-2.5 h-2.5" />
              Show {previewLines} lines
            </>
          )}
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="bg-muted/20">
          {loading && (
            <div className="flex items-center justify-center py-6 text-[12px] text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin mr-2" />
              Fetching from GitHub…
            </div>
          )}
          {error && (
            <div className="flex items-start gap-2 px-3 py-3 text-[12px] text-destructive">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {snippet && (
            <div className="overflow-auto max-h-96 font-mono text-[11.5px] leading-relaxed">
              {snippet.content.split("\n").map((line, idx) => (
                <div key={idx} className="flex">
                  <span className="select-none w-10 text-right pr-2 py-px text-muted-foreground tabular-nums border-r border-border shrink-0">
                    {snippet.start + idx}
                  </span>
                  <span className="px-3 py-px whitespace-pre">{line || " "}</span>
                </div>
              ))}
              {snippet.totalLines > snippet.end && (
                <div className="text-[10.5px] text-muted-foreground text-center py-2 border-t border-border">
                  Showing {snippet.start}–{snippet.end} of {snippet.totalLines.toLocaleString()} lines ·{" "}
                  <a
                    href={snippet.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-foreground"
                  >
                    open full file
                  </a>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
