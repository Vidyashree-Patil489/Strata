import { useMemo, useState } from "react";
import { GitCommit, Plus, Minus, FileCode2, Clock } from "lucide-react";

interface PushPoint {
  commitSha: string;
  pushedAt: string;
  files: string[];
  fileDiffs?: Array<{
    filename: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

interface Props {
  pushes: PushPoint[];
}

interface PushRow {
  sha: string;
  shaShort: string;
  pushedAt: string;
  additions: number;
  deletions: number;
  net: number;
  fileCount: number;
  files: string[];
  hasDiffs: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function formatNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function basename(p: string): string {
  const i = p.lastIndexOf("/");
  return i >= 0 ? p.slice(i + 1) : p;
}

// ── Composition bar — the proportion of additions vs deletions overall ──

function CompositionBar({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  const total = additions + deletions;
  if (total === 0) {
    return (
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full w-full bg-muted" />
      </div>
    );
  }
  const addPct = (additions / total) * 100;
  const delPct = 100 - addPct;
  return (
    <div className="flex items-center gap-1 h-2.5 rounded-full overflow-hidden bg-muted">
      {additions > 0 && (
        <div
          className="h-full transition-all"
          style={{
            width: `${addPct}%`,
            background: "linear-gradient(90deg, #22c55e, #15803d)",
          }}
          title={`+${additions} additions (${Math.round(addPct)}%)`}
        />
      )}
      {deletions > 0 && (
        <div
          className="h-full transition-all"
          style={{
            width: `${delPct}%`,
            background: "linear-gradient(90deg, #ef4444, #b91c1c)",
          }}
          title={`−${deletions} deletions (${Math.round(delPct)}%)`}
        />
      )}
    </div>
  );
}

// ── Per-push row ──────────────────────────────────────────────────────

function PushRow({
  row,
  maxChurn,
  active,
  onHover,
  onLeave,
}: {
  row: PushRow;
  maxChurn: number;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  const churn = row.additions + row.deletions;
  // Per-row bar width is proportional to this push's churn vs the largest one.
  const barPct = maxChurn > 0 ? Math.max(2, (churn / maxChurn) * 100) : 0;
  const addOfChurn =
    churn > 0 ? (row.additions / churn) * 100 : row.hasDiffs ? 50 : 0;

  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className="group rounded-lg border border-border px-3 py-2.5 transition-all"
      style={{
        background: active ? "rgba(79, 70, 229, 0.04)" : "var(--card)",
        borderColor: active ? "rgba(79, 70, 229, 0.3)" : "var(--border)",
      }}
    >
      {/* Top row — sha + time + counts */}
      <div className="flex items-center gap-3">
        <div
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background:
              row.net > 0
                ? "#15803d"
                : row.net < 0
                  ? "#b91c1c"
                  : "#a8a29e",
          }}
        />
        <span className="font-mono text-[12px] text-foreground tabular-nums">
          {row.shaShort}
        </span>
        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
          <Clock className="w-2.5 h-2.5" />
          {relativeTime(row.pushedAt)}
        </span>
        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
          <FileCode2 className="w-2.5 h-2.5" />
          {row.fileCount} file{row.fileCount === 1 ? "" : "s"}
        </span>

        <div className="ml-auto flex items-center gap-2 font-mono text-[11.5px] tabular-nums">
          {row.hasDiffs ? (
            <>
              <span style={{ color: "#15803d" }}>+{row.additions}</span>
              <span className="text-muted-foreground">/</span>
              <span style={{ color: "#b91c1c" }}>−{row.deletions}</span>
            </>
          ) : (
            <span className="text-muted-foreground">
              {row.fileCount} file{row.fileCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {/* Mini activity bar */}
      <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden flex">
        <div
          className="h-full"
          style={{
            width: `${barPct}%`,
            background: row.hasDiffs
              ? `linear-gradient(90deg,
                  #22c55e 0%,
                  #15803d ${addOfChurn}%,
                  #ef4444 ${addOfChurn}%,
                  #b91c1c 100%)`
              : "linear-gradient(90deg, #6366f1, #4338ca)",
            transition: "width 220ms ease",
          }}
        />
      </div>

      {/* Files preview — appears on hover */}
      {active && row.files.length > 0 && (
        <div className="mt-2 pt-2 border-t border-border flex flex-wrap gap-1">
          {row.files.slice(0, 6).map((f) => (
            <span
              key={f}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-muted text-[10.5px] font-mono text-muted-foreground"
              title={f}
            >
              <FileCode2 className="w-2.5 h-2.5" />
              {basename(f)}
            </span>
          ))}
          {row.files.length > 6 && (
            <span className="text-[10.5px] text-muted-foreground self-center">
              +{row.files.length - 6} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────

export function CodebaseGrowthChart({ pushes }: Props) {
  const [activeSha, setActiveSha] = useState<string | null>(null);

  const rows: PushRow[] = useMemo(() => {
    if (!pushes || pushes.length === 0) return [];

    // De-dupe: same commitSha + pushedAt is the same logical push, re-delivered.
    const seen = new Set<string>();
    const unique: PushPoint[] = [];
    for (const p of pushes) {
      const key = `${p.commitSha}::${p.pushedAt}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(p);
    }

    // Newest first — the feed reads top-down like a commit log.
    unique.sort(
      (a, b) => new Date(b.pushedAt).getTime() - new Date(a.pushedAt).getTime(),
    );

    return unique.map((p) => {
      const diffs = p.fileDiffs ?? [];
      const additions = diffs.reduce((s, d) => s + (d.additions ?? 0), 0);
      const deletions = diffs.reduce((s, d) => s + (d.deletions ?? 0), 0);
      return {
        sha: p.commitSha,
        shaShort: (p.commitSha ?? "unknown").slice(0, 7),
        pushedAt: p.pushedAt,
        additions,
        deletions,
        net: additions - deletions,
        fileCount: p.files?.length ?? 0,
        files: p.files ?? [],
        hasDiffs: additions + deletions > 0,
      };
    });
  }, [pushes]);

  if (rows.length === 0) {
    return (
      <div className="clay-card p-5">
        <p className="text-[12px] font-medium mb-1">Push activity</p>
        <p className="text-[11px] text-muted-foreground">
          No pushes recorded yet for this repo.
        </p>
      </div>
    );
  }

  const totalAdd = rows.reduce((s, r) => s + r.additions, 0);
  const totalDel = rows.reduce((s, r) => s + r.deletions, 0);
  const totalLines = totalAdd + totalDel;
  const totalFiles = rows.reduce((s, r) => s + r.fileCount, 0);
  const maxChurn = Math.max(
    1,
    ...rows.map((r) => r.additions + r.deletions || r.fileCount),
  );
  const anyDiffs = rows.some((r) => r.hasDiffs);

  return (
    <div className="clay-card p-5">
      {/* Header */}
      <div className="flex items-baseline justify-between gap-3 mb-4 pb-4 border-b border-border">
        <div>
          <p className="text-[12px] font-medium flex items-center gap-2">
            <GitCommit className="w-3.5 h-3.5 text-muted-foreground" />
            Push activity
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Per-push breakdown · {rows.length} push
            {rows.length === 1 ? "" : "es"}
          </p>
        </div>

        {/* Top-right stats */}
        <div className="flex items-center gap-5">
          {anyDiffs ? (
            <>
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
                  <Plus className="w-2.5 h-2.5" style={{ color: "#15803d" }} />
                  Added
                </p>
                <p
                  className="text-[16px] font-semibold tabular-nums leading-none mt-0.5"
                  style={{ color: "#15803d" }}
                >
                  {formatNum(totalAdd)}
                </p>
              </div>
              <div className="w-px h-7 bg-border" />
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1 justify-end">
                  <Minus className="w-2.5 h-2.5" style={{ color: "#b91c1c" }} />
                  Removed
                </p>
                <p
                  className="text-[16px] font-semibold tabular-nums leading-none mt-0.5"
                  style={{ color: "#b91c1c" }}
                >
                  {formatNum(totalDel)}
                </p>
              </div>
              <div className="w-px h-7 bg-border" />
              <div className="text-right">
                <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                  Net
                </p>
                <p
                  className="text-[16px] font-semibold tabular-nums leading-none mt-0.5"
                  style={{
                    color: totalAdd - totalDel >= 0 ? "#15803d" : "#b91c1c",
                  }}
                >
                  {totalAdd - totalDel >= 0 ? "+" : ""}
                  {formatNum(totalAdd - totalDel)}
                </p>
              </div>
            </>
          ) : (
            <div className="text-right">
              <p className="text-[9px] uppercase tracking-wider text-muted-foreground">
                Files touched
              </p>
              <p className="text-[16px] font-semibold tabular-nums leading-none mt-0.5">
                {formatNum(totalFiles)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Composition bar */}
      {anyDiffs && (
        <div className="mb-5">
          <div className="flex items-baseline justify-between mb-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Composition
            </span>
            <span className="text-[10.5px] text-muted-foreground tabular-nums">
              {totalLines} line{totalLines === 1 ? "" : "s"} changed
            </span>
          </div>
          <CompositionBar additions={totalAdd} deletions={totalDel} />
          <div className="flex items-center gap-3 mt-1.5 text-[10.5px]">
            <span className="flex items-center gap-1" style={{ color: "#15803d" }}>
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: "linear-gradient(90deg, #22c55e, #15803d)" }}
              />
              +{totalAdd} additions
              <span className="text-muted-foreground ml-1">
                ({totalLines > 0 ? Math.round((totalAdd / totalLines) * 100) : 0}%)
              </span>
            </span>
            <span className="flex items-center gap-1" style={{ color: "#b91c1c" }}>
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: "linear-gradient(90deg, #ef4444, #b91c1c)" }}
              />
              −{totalDel} deletions
              <span className="text-muted-foreground ml-1">
                ({totalLines > 0 ? Math.round((totalDel / totalLines) * 100) : 0}%)
              </span>
            </span>
          </div>
        </div>
      )}

      {/* Per-push rows */}
      <div>
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Pushes
          </span>
          <span className="text-[10.5px] text-muted-foreground">
            Hover for files
          </span>
        </div>
        <div className="space-y-2 max-h-[280px] overflow-y-auto pr-1">
          {rows.map((row) => (
            <PushRow
              key={row.sha + row.pushedAt}
              row={row}
              maxChurn={maxChurn}
              active={activeSha === row.sha + row.pushedAt}
              onHover={() => setActiveSha(row.sha + row.pushedAt)}
              onLeave={() => setActiveSha(null)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
