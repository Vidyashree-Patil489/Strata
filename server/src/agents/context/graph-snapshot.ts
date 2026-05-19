/**
 * Builds a repo dependency-graph snapshot at an arbitrary commit SHA.
 * Pure tree-sitter — no LLM, no cost.
 *
 * Designed to be called repeatedly across many commits (for the
 * "Build history" feature). The expensive part is fetching file
 * contents from GitHub; we cache by blob SHA so unchanged files
 * across commits are fetched once and reused across snapshots.
 *
 * Call sites:
 *  - context.job.ts → after every normal index, save the CURRENT graph
 *  - historical-graph.job.ts → walks the last N commits, builds one
 *    snapshot per commit
 */
import * as path from "path";
import { githubAppFetch } from "../../utils/github";
import {
  extractTags,
  shouldSkip,
  getExtension,
  buildGraph,
  runPageRank,
  type Tag,
} from "./indexer";
import type { IGraphNode, IGraphEdge } from "../../models/RepoGraphSnapshot";

const MAX_FILE_SIZE = 100 * 1024;
const MAX_FILES = 3000;
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
  sha: string;
}

export interface SnapshotResult {
  nodes: IGraphNode[];
  edges: IGraphEdge[];
  /** Number of files actually parsed (some are skipped — unsupported lang/too big) */
  filesIndexed: number;
  /** Total files in the eligible set (before parser-language filter) */
  filesTotal: number;
  /** How many file fetches we actually made (vs. cache hits) */
  fetchesMade: number;
  cacheHits: number;
  durationMs: number;
}

/**
 * Cache keyed by blob SHA — content of a given blob never changes
 * (git is content-addressed). When indexing many commits in sequence,
 * the same blob SHA appears in every commit where the file didn't
 * change, so the cache hit rate is very high.
 *
 * Memory: ~100KB max per file × ~3000 max files = ~300MB worst case.
 * For typical real-world calls (~30 commits × ~500 files with high
 * overlap) actual memory usage is ~50–80MB. Caller is responsible
 * for clearing when no longer needed.
 */
export class BlobCache {
  private store = new Map<string, string>();
  hits = 0;
  misses = 0;

  get(sha: string): string | undefined {
    const val = this.store.get(sha);
    if (val !== undefined) this.hits++;
    return val;
  }

  set(sha: string, content: string): void {
    // Don't cache giant files; they're skipped from parsing anyway.
    if (content.length > MAX_FILE_SIZE) return;
    this.store.set(sha, content);
    this.misses++;
  }

  clear(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  size(): number {
    return this.store.size;
  }
}

export interface SnapshotOptions {
  repoFullName: string;
  commitSha: string;
  token: string;
  cache?: BlobCache;
}

/**
 * Fetch the tree at a commit, parse every supported file, build the
 * dependency graph, run PageRank, return cytoscape-ready nodes+edges.
 *
 * Throws on unrecoverable errors (e.g. GitHub 401). Per-file fetch
 * failures are silently dropped — better to have an incomplete graph
 * than no graph at all.
 */
export async function extractGraphAtCommit(
  opts: SnapshotOptions,
): Promise<SnapshotResult> {
  const start = Date.now();
  const cache = opts.cache ?? new BlobCache();

  // 1. Fetch the recursive tree at this commit
  const treeRes = await githubAppFetch(
    `/repos/${opts.repoFullName}/git/trees/${opts.commitSha}?recursive=1`,
    opts.token,
  );
  if (!treeRes.ok) {
    throw new Error(
      `Failed to fetch tree at ${opts.commitSha.slice(0, 7)}: HTTP ${treeRes.status}`,
    );
  }

  const treeData = (await treeRes.json()) as {
    tree: TreeEntry[];
    truncated: boolean;
  };

  const eligible = treeData.tree.filter((entry) => {
    if (entry.type !== "blob") return false;
    if (shouldSkip(entry.path)) return false;
    if (entry.size && entry.size > MAX_FILE_SIZE) return false;
    return true;
  });
  const filesToProcess = eligible.slice(0, MAX_FILES);

  const cacheHitsBefore = cache.hits;
  const fetchesBefore = cache.misses;

  // 2. Parse each supported file, with cache-aware fetching
  const allTags: Tag[] = [];
  let filesIndexed = 0;

  for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
    const batch = filesToProcess.slice(i, i + BATCH_SIZE);
    if (i > 0) await sleep(BATCH_DELAY_MS);

    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const ext = getExtension(entry.path);
        if (!ext) return null;

        // Check cache first by blob SHA
        let content = cache.get(entry.sha);
        if (content === undefined) {
          // Fetch raw blob by SHA — content-addressed, never changes
          const blobRes = await githubAppFetch(
            `/repos/${opts.repoFullName}/git/blobs/${entry.sha}`,
            opts.token,
            { headers: { Accept: "application/vnd.github.raw" } },
          );
          if (!blobRes.ok) return null;
          content = await blobRes.text();
          cache.set(entry.sha, content);
        }
        if (!content.trim()) return null;

        const tags = extractTags(entry.path, content);
        if (tags.length > 0) filesIndexed++;
        return tags;
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) allTags.push(...r.value);
    }
  }

  // 3. Build the graph from tags
  const graphData = buildGraph(allTags);

  // 4. PageRank for node sizing
  const allFilePaths = filesToProcess.map((f) => f.path);
  const ranks = runPageRank(graphData.edges, allFilePaths);

  // 5. Convert to cytoscape-ready shape
  // Node = file. Compound parent inferred client-side from `dir`.
  const defCountByFile = new Map<string, number>();
  for (const d of graphData.definitions) {
    defCountByFile.set(d.path, (defCountByFile.get(d.path) ?? 0) + 1);
  }

  // Only include files that actually appear in the graph (had a def or
  // appear as an edge endpoint) — otherwise a 3K-file repo dumps 3K
  // disconnected dots into the viewer. Cytoscape handles ~1K interactive
  // nodes well; isolated files are noise.
  const filesInGraph = new Set<string>();
  for (const d of graphData.definitions) filesInGraph.add(d.path);
  for (const e of graphData.edges) {
    filesInGraph.add(e.source);
    filesInGraph.add(e.target);
  }

  const nodes: IGraphNode[] = [...filesInGraph].map((p) => ({
    id: p,
    label: path.basename(p),
    dir: topLevelDir(p),
    pageRank: ranks.get(p) ?? 0,
    defCount: defCountByFile.get(p) ?? 0,
  }));

  // Edges: drop self-loops + dedupe (the indexer's Aider-style self-edges
  // are useful for PageRank weighting but ugly in a viz).
  const edgeSeen = new Set<string>();
  const edges: IGraphEdge[] = [];
  for (const e of graphData.edges) {
    if (e.source === e.target) continue;
    const k = `${e.source}${e.target}`;
    if (edgeSeen.has(k)) continue;
    edgeSeen.add(k);
    edges.push({ source: e.source, target: e.target, weight: e.weight });
  }

  return {
    nodes,
    edges,
    filesIndexed,
    filesTotal: eligible.length,
    fetchesMade: cache.misses - fetchesBefore,
    cacheHits: cache.hits - cacheHitsBefore,
    durationMs: Date.now() - start,
  };
}

/** First path segment, or "." for root-level files. */
function topLevelDir(p: string): string {
  const i = p.indexOf("/");
  return i === -1 ? "." : p.slice(0, i);
}
