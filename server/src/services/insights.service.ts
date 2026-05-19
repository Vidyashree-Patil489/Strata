import mongoose from "mongoose";
import { Repo } from "../models/Repo";
import { RepoContext } from "../models/RepoContext";
import RepoHealthSnapshot from "../models/RepoHealthSnapshot";
import FilePushHistory from "../models/FilePushHistory";

/**
 * Repo Insights — six analyzer lenses that derive *new* information from
 * the indexed data. Each lens deliberately surfaces patterns that no other
 * page exposes:
 *
 *   1. co-change-patterns    files that change together in pushes
 *   2. layer-hints           directional architecture violations
 *   3. test-coverage-map     source files without matching tests
 *   4. score-forecast        linear projection of health score
 *   5. directory-hotspots    churn aggregated by directory
 *   6. stable-foundations    load-bearing files that DON'T churn
 *
 * Pure derivation — no extra LLM calls, no extra GitHub roundtrips.
 */

export type InsightSeverity = "info" | "good" | "warning" | "critical";

export interface InsightEvidence {
  files?: string[];
  metrics?: Record<string, number | string>;
}

export interface Insight {
  id: string;
  analyzer: AnalyzerName;
  severity: InsightSeverity;
  title: string;
  description: string;
  evidence?: InsightEvidence;
  suggestion?: string;
}

export type AnalyzerName =
  | "co-change-patterns"
  | "layer-hints"
  | "test-coverage-map"
  | "score-forecast"
  | "directory-hotspots"
  | "stable-foundations";

export const ANALYZER_META: Record<
  AnalyzerName,
  { label: string; description: string }
> = {
  "co-change-patterns": {
    label: "Co-Change Patterns",
    description:
      "Pairs of files that change together in pushes despite no import edge between them — hidden coupling that the dependency graph can't see.",
  },
  "layer-hints": {
    label: "Architectural Layer Hints",
    description:
      "Directional violations inferred from path conventions — utilities depending on features, models depending on UI, that kind of thing.",
  },
  "test-coverage-map": {
    label: "Test Coverage Map",
    description:
      "Source files without a matching test file (by filename convention). Heuristic, not coverage instrumentation, but surfaces obvious gaps.",
  },
  "score-forecast": {
    label: "Score Forecast",
    description:
      "Linear projection of the health score from the last N snapshots — extrapolated forward to flag drift before it becomes a problem.",
  },
  "directory-hotspots": {
    label: "Directory Hotspots",
    description:
      "Push churn aggregated to the directory level — sometimes a whole subtree is hot even when no individual file stands out.",
  },
  "stable-foundations": {
    label: "Stable Foundations",
    description:
      "Top-PageRank files that haven't been touched in recent pushes — good news worth surfacing. These are the parts of the codebase you can build on with confidence.",
  },
};

export interface InsightsResponse {
  repoId: string;
  repoFullName: string;
  generatedAt: string;
  snapshot: {
    score: number;
    computedAt: string;
  } | null;
  analyzers: Record<AnalyzerName, { label: string; description: string }>;
  insights: Insight[];
  summary: {
    total: number;
    critical: number;
    warning: number;
    info: number;
    good: number;
  };
}

// ── Path helpers ───────────────────────────────────────────────────────

const TEST_FILE_PATTERNS: RegExp[] = [
  /\.test\.[jt]sx?$/,
  /\.spec\.[jt]sx?$/,
  /\.test\.py$/,
  /_test\.go$/,
  /(^|\/)test_/,
  /\/__tests__\//,
  /\/tests?\//,
  /\/spec\//,
];

const TESTABLE_SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb",
]);

function isTestFile(path: string): boolean {
  return TEST_FILE_PATTERNS.some((re) => re.test(path));
}

function pathExt(path: string): string {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i).toLowerCase() : "";
}

function topDir(path: string, depth = 2): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return ".";
  return parts.slice(0, depth).join("/");
}

// ── Heuristic layer classification from file paths ─────────────────────

type Layer = "utility" | "model" | "feature" | "page" | "test" | "unknown";

function classifyLayer(path: string): Layer {
  if (isTestFile(path)) return "test";
  if (/(^|\/)(utils?|helpers?|lib|shared|common)\//i.test(path)) return "utility";
  if (/(^|\/)(types?|models?|schemas?|entities)\//i.test(path)) return "model";
  if (/(^|\/)(pages?|routes|views|screens)\//i.test(path)) return "page";
  if (/(^|\/)(features?|modules?|components?|containers?)\//i.test(path))
    return "feature";
  return "unknown";
}

// Violation = layer A "shouldn't" import from layer B. Lower-level layers
// should never depend on higher-level ones.
const LAYER_ORDER: Record<Layer, number> = {
  utility: 1,
  model:   1,
  feature: 2,
  page:    3,
  test:    99,
  unknown: 50,
};

function isLayerViolation(srcLayer: Layer, dstLayer: Layer): boolean {
  if (srcLayer === "unknown" || dstLayer === "unknown") return false;
  if (srcLayer === "test" || dstLayer === "test") return false;
  return LAYER_ORDER[srcLayer] < LAYER_ORDER[dstLayer];
}

// ── Analyzers ──────────────────────────────────────────────────────────

/** 1. Co-change patterns — file pairs that move together in pushes. */
function coChangePatternsAnalyzer(
  pushes: any[],
  graphEdges: any[],
): Insight[] {
  if (pushes.length < 4) {
    return [
      {
        id: "cc-insufficient",
        analyzer: "co-change-patterns",
        severity: "info",
        title: "Not enough push history yet",
        description:
          "Co-change analysis needs at least 4 pushes to find statistically meaningful pairs. Once you accumulate more push history, hidden coupling will surface here.",
      },
    ];
  }

  // Count per-file appearances and per-pair co-occurrences.
  const fileCount = new Map<string, number>();
  const pairCount = new Map<string, number>();
  for (const p of pushes) {
    const files = [...new Set<string>(p.files ?? [])];
    for (const f of files) fileCount.set(f, (fileCount.get(f) ?? 0) + 1);
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const a = files[i];
        const b = files[j];
        const key = a < b ? `${a}::${b}` : `${b}::${a}`;
        pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
      }
    }
  }

  // Build set of import-edge pairs to subtract "expected" co-change.
  const importPairs = new Set<string>();
  for (const e of graphEdges as any[]) {
    const s: string = e.source ?? e.from;
    const t: string = e.target ?? e.to;
    if (!s || !t) continue;
    const key = s < t ? `${s}::${t}` : `${t}::${s}`;
    importPairs.add(key);
  }

  // Find pairs that co-change in >50% of the times either changed AND
  // co-changed at least 3 times AND do NOT have an import edge. That's
  // "hidden coupling" — they move together for reasons not visible to
  // the graph.
  type Hidden = { a: string; b: string; count: number; pct: number };
  const hidden: Hidden[] = [];
  for (const [key, count] of pairCount) {
    if (count < 3) continue;
    const [a, b] = key.split("::");
    const denom = Math.min(fileCount.get(a) ?? 1, fileCount.get(b) ?? 1);
    const pct = denom > 0 ? count / denom : 0;
    if (pct < 0.5) continue;
    if (importPairs.has(key)) continue;
    hidden.push({ a, b, count, pct });
  }
  hidden.sort((x, y) => y.count - x.count);

  if (hidden.length === 0) {
    return [
      {
        id: "cc-clean",
        analyzer: "co-change-patterns",
        severity: "good",
        title: "No hidden coupling detected",
        description: `Across ${pushes.length} pushes, no file pair moves together so consistently that it would suggest unspoken coupling outside the import graph.`,
      },
    ];
  }

  return hidden.slice(0, 5).map((h, i) => ({
    id: `cc-pair-${i}`,
    analyzer: "co-change-patterns",
    severity: h.pct >= 0.8 ? "warning" : "info",
    title: `${h.a.split("/").pop()}  ↔  ${h.b.split("/").pop()}  (changed together ${h.count} times)`,
    description: `These two files don't import each other, yet they change together in ${Math.round(h.pct * 100)}% of the pushes that touch either one. That's a sign of implicit coupling — a shared concept, a hidden contract, or duplicated logic that has to be kept in sync manually.`,
    evidence: {
      files: [h.a, h.b],
      metrics: {
        coChanges: h.count,
        coChangeRate: `${Math.round(h.pct * 100)}%`,
        importEdge: "none",
      },
    },
    suggestion:
      "Either extract the shared concept into a third file that both depend on, or make the implicit relationship explicit (interface, shared type, event).",
  }));
}

/** 2. Architectural layer hints — directional violations from path conv. */
function layerHintsAnalyzer(graphEdges: any[]): Insight[] {
  const violations: Array<{
    src: string;
    dst: string;
    srcLayer: Layer;
    dstLayer: Layer;
  }> = [];

  for (const e of graphEdges as any[]) {
    const s: string = e.source ?? e.from;
    const t: string = e.target ?? e.to;
    if (!s || !t || s === t) continue;
    const sl = classifyLayer(s);
    const dl = classifyLayer(t);
    if (isLayerViolation(sl, dl)) {
      violations.push({ src: s, dst: t, srcLayer: sl, dstLayer: dl });
    }
  }

  if (violations.length === 0) {
    return [
      {
        id: "lh-clean",
        analyzer: "layer-hints",
        severity: "good",
        title: "No layer violations detected",
        description:
          "Files in lower-level directories (utils, models, lib) don't import from higher-level directories (pages, features). The architecture's dependency direction is intact.",
      },
    ];
  }

  // Group by the kind of violation (e.g. utility→page) for readability.
  const groups = new Map<string, typeof violations>();
  for (const v of violations) {
    const key = `${v.srcLayer}→${v.dstLayer}`;
    const arr = groups.get(key) ?? [];
    arr.push(v);
    groups.set(key, arr);
  }

  const out: Insight[] = [];
  let idx = 0;
  for (const [key, items] of [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const [srcLayer, dstLayer] = key.split("→") as [Layer, Layer];
    const sev: InsightSeverity = items.length > 5 ? "critical" : "warning";
    const examples = items
      .slice(0, 5)
      .map((v) => `• ${v.src}\n    → ${v.dst}`)
      .join("\n");
    out.push({
      id: `lh-${idx++}`,
      analyzer: "layer-hints",
      severity: sev,
      title: `${items.length} ${srcLayer} → ${dstLayer} import${items.length === 1 ? "" : "s"}`,
      description: `${srcLayer} files should not depend on ${dstLayer} files (it inverts the architectural dependency direction). Examples:\n${examples}`,
      evidence: {
        files: items.slice(0, 8).flatMap((v) => [v.src, v.dst]),
        metrics: { violations: items.length },
      },
      suggestion:
        srcLayer === "utility" || srcLayer === "model"
          ? `Move the shared concept that ${srcLayer} files need into a lower-level module, or invert the call site so the ${dstLayer} layer reaches into utilities (not the other way around).`
          : "Re-examine the boundary — either the path naming is misleading, or there's an architecture leak.",
    });
  }

  return out;
}

/** 3. Test coverage map — source files without matching test files. */
function testCoverageMapAnalyzer(fileTree: string[]): Insight[] {
  if (!fileTree || fileTree.length === 0) return [];

  const sourceFiles: string[] = [];
  const testFiles: string[] = [];
  for (const f of fileTree) {
    if (isTestFile(f)) {
      testFiles.push(f);
      continue;
    }
    if (!TESTABLE_SOURCE_EXTS.has(pathExt(f))) continue;
    // Skip likely non-testable artifacts.
    if (/\.d\.ts$/.test(f)) continue;
    if (/(^|\/)(index|main|app|server|worker|cli)\.[jt]sx?$/.test(f)) continue;
    if (/\.config\.[jt]sx?$/.test(f)) continue;
    sourceFiles.push(f);
  }

  if (sourceFiles.length === 0) {
    return [
      {
        id: "tc-empty",
        analyzer: "test-coverage-map",
        severity: "info",
        title: "No source files matched the heuristic",
        description:
          "The repo has no files in supported source extensions that look like they'd be testable.",
      },
    ];
  }

  // For each source file, look for a test file with a matching basename.
  const testBaseNames = new Set<string>();
  for (const t of testFiles) {
    const base = t
      .split("/")
      .pop()!
      .replace(/\.(test|spec)\.[jt]sx?$/, "")
      .replace(/\.test\.py$/, "")
      .replace(/_test\.go$/, "");
    testBaseNames.add(base);
  }

  const untested: string[] = [];
  for (const s of sourceFiles) {
    const base = s.split("/").pop()!.replace(/\.[^.]+$/, "");
    if (testBaseNames.has(base)) continue;
    untested.push(s);
  }

  const coveragePct = sourceFiles.length
    ? Math.round(((sourceFiles.length - untested.length) / sourceFiles.length) * 100)
    : 100;

  const out: Insight[] = [];

  let sev: InsightSeverity = "good";
  if (coveragePct < 30) sev = "critical";
  else if (coveragePct < 60) sev = "warning";
  else if (coveragePct < 80) sev = "info";

  out.push({
    id: "tc-summary",
    analyzer: "test-coverage-map",
    severity: sev,
    title: `Approx. ${coveragePct}% of source files have a matching test`,
    description: `Counted ${sourceFiles.length} testable source file${sourceFiles.length === 1 ? "" : "s"} and ${testFiles.length} test file${testFiles.length === 1 ? "" : "s"}. ${untested.length} source file${untested.length === 1 ? " has" : "s have"} no test file with a matching basename.`,
    evidence: {
      metrics: {
        sourceFiles: sourceFiles.length,
        testFiles: testFiles.length,
        untested: untested.length,
        approxCoverage: `${coveragePct}%`,
      },
    },
    suggestion:
      "This is a filename heuristic, not real coverage. But the gap is a fast way to spot whole modules that don't have a sibling test file.",
  });

  if (untested.length > 0) {
    out.push({
      id: "tc-untested",
      analyzer: "test-coverage-map",
      severity: sev === "good" ? "info" : sev,
      title: `${untested.length} source file${untested.length === 1 ? "" : "s"} without a matching test`,
      description: untested.slice(0, 8).map((f) => `• ${f}`).join("\n"),
      evidence: { files: untested.slice(0, 20) },
    });
  }

  return out;
}

/** 4. Score forecast — linear projection from recent snapshots. */
function scoreForecastAnalyzer(snapshots: any[]): Insight[] {
  if (snapshots.length < 3) {
    return [
      {
        id: "sf-insufficient",
        analyzer: "score-forecast",
        severity: "info",
        title: "Forecasting needs at least 3 snapshots",
        description: `Only ${snapshots.length} snapshot${snapshots.length === 1 ? "" : "s"} so far. Once you accumulate a few more indexing runs, a slope will appear here.`,
      },
    ];
  }

  // Simple linear regression: y = score, x = days since first snapshot.
  const t0 = new Date(snapshots[0].computedAt).getTime();
  const pts = snapshots.map((s) => ({
    x: (new Date(s.computedAt).getTime() - t0) / 86400000,
    y: s.score,
  }));
  const n = pts.length;
  const sumX = pts.reduce((a, p) => a + p.x, 0);
  const sumY = pts.reduce((a, p) => a + p.y, 0);
  const sumXY = pts.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = pts.reduce((a, p) => a + p.x * p.x, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  const slope = denom !== 0 ? (sumXY - n * meanX * meanY) / denom : 0;
  const intercept = meanY - slope * meanX;
  const current = pts[pts.length - 1].y;

  // Project 7d and 30d from latest.
  const latestX = pts[pts.length - 1].x;
  const proj7 = Math.round(slope * (latestX + 7) + intercept);
  const proj30 = Math.round(slope * (latestX + 30) + intercept);

  let sev: InsightSeverity;
  let direction: string;
  if (Math.abs(slope) < 0.05) {
    sev = "info";
    direction = "flat";
  } else if (slope > 0) {
    sev = "good";
    direction = `+${slope.toFixed(2)} pts/day`;
  } else {
    sev = slope < -0.5 ? "critical" : "warning";
    direction = `${slope.toFixed(2)} pts/day`;
  }

  const out: Insight[] = [
    {
      id: "sf-slope",
      analyzer: "score-forecast",
      severity: sev,
      title:
        slope < -0.05
          ? `Score is trending down (${direction})`
          : slope > 0.05
            ? `Score is trending up (${direction})`
            : "Score is flat across recent snapshots",
      description: `Linear regression over the last ${n} snapshots projects:\n• 7 days from now: ${Math.max(0, Math.min(100, proj7))}\n• 30 days from now: ${Math.max(0, Math.min(100, proj30))}\n\nCurrent score is ${current}.`,
      evidence: {
        metrics: {
          snapshots: n,
          slopePerDay: slope.toFixed(3),
          projected7d: Math.max(0, Math.min(100, proj7)),
          projected30d: Math.max(0, Math.min(100, proj30)),
        },
      },
      suggestion:
        slope < -0.1
          ? "If the trend holds, the score will visibly degrade within the month. Address the largest signal moving against you (check Health Trajectory)."
          : slope > 0.1
            ? "Whatever you're doing is working — keep the same pattern up."
            : undefined,
    },
  ];

  // If the trend would breach a meaningful threshold, surface it.
  if (slope < -0.05) {
    const daysToSixty = current > 60 ? (current - 60) / -slope : null;
    const daysToForty = current > 40 ? (current - 40) / -slope : null;
    if (daysToSixty && daysToSixty < 60) {
      out.push({
        id: "sf-breach-60",
        analyzer: "score-forecast",
        severity: "warning",
        title: `Projected to drop below 60 in ~${Math.round(daysToSixty)} day${Math.round(daysToSixty) === 1 ? "" : "s"}`,
        description:
          "60 is the threshold the dashboard uses for the 'acceptable' band. At the current slope, the repo would cross it without intervention.",
      });
    }
    if (daysToForty && daysToForty < 90) {
      out.push({
        id: "sf-breach-40",
        analyzer: "score-forecast",
        severity: "critical",
        title: `Projected to drop below 40 in ~${Math.round(daysToForty)} day${Math.round(daysToForty) === 1 ? "" : "s"}`,
        description:
          "Below 40 is the 'poor' band — typically reached when coupling concentration AND churn are both elevated.",
      });
    }
  }

  return out;
}

/** 5. Directory hotspots — push churn aggregated by directory. */
function directoryHotspotsAnalyzer(pushes: any[]): Insight[] {
  if (pushes.length === 0) {
    return [];
  }

  const dirTouch = new Map<string, number>();
  const totalPushes = pushes.length;
  for (const p of pushes) {
    const touchedDirs = new Set<string>();
    for (const f of p.files ?? []) {
      touchedDirs.add(topDir(f, 2));
    }
    for (const d of touchedDirs) {
      dirTouch.set(d, (dirTouch.get(d) ?? 0) + 1);
    }
  }

  const ranked = [...dirTouch.entries()]
    .map(([dir, count]) => ({
      dir,
      count,
      pct: count / totalPushes,
    }))
    .filter((d) => d.count >= 2)
    .sort((a, b) => b.count - a.count);

  if (ranked.length === 0) {
    return [
      {
        id: "dh-quiet",
        analyzer: "directory-hotspots",
        severity: "info",
        title: "No directory stands out",
        description:
          "Recent pushes are spread evenly enough that no single directory was touched repeatedly.",
      },
    ];
  }

  const out: Insight[] = [];
  for (const r of ranked.slice(0, 5)) {
    let sev: InsightSeverity = "info";
    if (r.pct > 0.7) sev = "warning";
    else if (r.pct > 0.4) sev = "info";

    out.push({
      id: `dh-${r.dir}`,
      analyzer: "directory-hotspots",
      severity: sev,
      title: `${r.dir === "." ? "(root)" : r.dir + "/"} — touched in ${r.count}/${totalPushes} pushes (${Math.round(r.pct * 100)}%)`,
      description: r.pct > 0.7
        ? "This directory is in the path of almost every push. Either it's the active feature area or it's structurally too coarse-grained — every change leaks into it."
        : `${Math.round(r.pct * 100)}% of recent pushes touch something under this directory.`,
      evidence: { metrics: { dir: r.dir, pushes: r.count, sharePct: `${Math.round(r.pct * 100)}%` } },
      suggestion:
        r.pct > 0.7
          ? "If this is shared utilities or types, consider whether the directory should be split. If it's a feature area, this is fine — just confirm it's not bleeding into unrelated work."
          : undefined,
    });
  }

  return out;
}

/** 6. Stable foundations — central files that DON'T churn. */
function stableFoundationsAnalyzer(
  ctx: any,
  pushes: any[],
): Insight[] {
  // Build PageRank per file.
  const byFile = new Map<string, number>();
  for (const d of (ctx?.definitions ?? []) as any[]) {
    const cur = byFile.get(d.path) ?? 0;
    if ((d.pageRankScore ?? 0) > cur) byFile.set(d.path, d.pageRankScore ?? 0);
  }
  if (byFile.size === 0) return [];

  const top = [...byFile.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30); // top-30 PageRank

  if (top.length === 0) return [];

  // Files that were touched in any recent push.
  const touched = new Set<string>();
  for (const p of pushes) for (const f of p.files ?? []) touched.add(f);

  const stable = top.filter(([path]) => !touched.has(path));

  if (stable.length === 0) {
    return [
      {
        id: "st-none",
        analyzer: "stable-foundations",
        severity: "warning",
        title: "Every top-30 file has been touched recently",
        description: `Out of the ${top.length} most central files in the dependency graph, none escaped recent pushes. That's a sign your load-bearing layer is in flux — risky for downstream work.`,
        suggestion:
          "Identify the most-imported files that could be frozen behind a stable interface. The fewer that change every push, the safer everything else gets to evolve.",
      },
    ];
  }

  return [
    {
      id: "st-list",
      analyzer: "stable-foundations",
      severity: "good",
      title: `${stable.length} of the top-${top.length} files haven't been touched recently`,
      description:
        "These are central in the dependency graph (lots of files depend on them) and have NOT changed across the recent pushes tracked. They're acting as a stable foundation — work that builds on them is lower-risk.",
      evidence: {
        files: stable.slice(0, 10).map(([p]) => p),
        metrics: {
          stableCount: stable.length,
          topPool: top.length,
        },
      },
      suggestion:
        "When you need to make a risky change elsewhere, prefer doing it in code that uses these files rather than in the files themselves.",
    },
  ];
}

// ── Public entry point ───────────────────────────────────────────────

export async function generateInsights(
  repoId: mongoose.Types.ObjectId,
): Promise<InsightsResponse> {
  const repo = await Repo.findOne({ _id: repoId });
  if (!repo) throw new Error("Repo not found");

  const [ctx, snapshots, pushes] = await Promise.all([
    RepoContext.findOne({ repoId }),
    RepoHealthSnapshot.find({ repoId }).sort({ computedAt: 1 }).limit(20),
    FilePushHistory.find({ repoId }).sort({ pushedAt: -1 }).limit(30),
  ]);

  const latest = snapshots[snapshots.length - 1] ?? null;
  const graphEdges = (ctx?.graphEdges ?? []) as any[];
  const fileTree = (ctx?.fileTree ?? []) as string[];

  const insights: Insight[] = [
    ...coChangePatternsAnalyzer(pushes, graphEdges),
    ...layerHintsAnalyzer(graphEdges),
    ...testCoverageMapAnalyzer(fileTree),
    ...scoreForecastAnalyzer(snapshots),
    ...directoryHotspotsAnalyzer(pushes),
    ...stableFoundationsAnalyzer(ctx, pushes),
  ];

  const summary = insights.reduce(
    (acc, i) => {
      acc.total++;
      acc[i.severity]++;
      return acc;
    },
    { total: 0, critical: 0, warning: 0, info: 0, good: 0 },
  );

  return {
    repoId: String(repoId),
    repoFullName: repo.fullName,
    generatedAt: new Date().toISOString(),
    snapshot: latest
      ? { score: latest.score, computedAt: latest.computedAt.toISOString() }
      : null,
    analyzers: ANALYZER_META,
    insights,
    summary,
  };
}
