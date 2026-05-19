/**
 * Repo Map Indexer — Aider-style tree-sitter approach
 *
 * 1. Fetch file tree from GitHub API
 * 2. Fetch file contents in batches
 * 3. Parse with tree-sitter, extract tags (defs + refs) using .scm queries
 * 4. Build dependency graph with graphology
 * 5. Run un-personalized PageRank for static map
 * 6. Generate compact text repo map
 * 7. Store definitions + graph edges for re-ranking at review time
 */
import * as fs from "fs";
import * as path from "path";
import Parser from "tree-sitter";
// @ts-ignore — no types for tree-sitter language packages
import JavaScript from "tree-sitter-javascript";
// @ts-ignore
import TypeScriptLangs from "tree-sitter-typescript";
// @ts-ignore
import Python from "tree-sitter-python";
// @ts-ignore
import Go from "tree-sitter-go";
// @ts-ignore
import Rust from "tree-sitter-rust";
// @ts-ignore
import Java from "tree-sitter-java";
// @ts-ignore
import C from "tree-sitter-c";
// @ts-ignore
import Cpp from "tree-sitter-cpp";
// @ts-ignore
import CSharp from "tree-sitter-c-sharp";
// @ts-ignore
import PHP from "tree-sitter-php";
// @ts-ignore
import Ruby from "tree-sitter-ruby";
// @ts-ignore
// import Kotlin from "tree-sitter-kotlin"; // removed: no Windows prebuilds
import { MultiDirectedGraph } from "graphology";
// @ts-ignore — CJS import from graphology-metrics
import pagerank from "graphology-metrics/centrality/pagerank";

import { githubAppFetch } from "../../utils/github";
import { RepoContext } from "../../models/RepoContext";
import type { Types } from "mongoose";

// ── Types ──

export interface Tag {
  path: string; // relative file path
  name: string; // symbol name
  kind: "def" | "ref";
  line: number; // 0-indexed line number
}

export interface StoredDefinition {
  path: string;
  name: string;
  line: number;
  kind: string; // e.g. "function", "class", "method", "interface", etc.
  pageRankScore: number;
}

export interface StoredEdge {
  source: string; // referencer file path
  target: string; // definer file path
  weight: number;
}

export interface IndexerOptions {
  repoFullName: string;
  headSha: string;
  installationToken: string;
  repoId: Types.ObjectId;
  changedFiles?: string[];
}

export interface IndexerResult {
  totalFiles: number;
  indexedFiles: number;
  skippedFiles: number;
  errors: string[];
  durationMs: number;
}

// ── Language config ──

const { typescript: TypeScript, tsx: TSX } = TypeScriptLangs;

interface LangConfig {
  parser: any; // tree-sitter language object
  scmFile: string; // .scm query filename
}

const LANG_MAP: Record<string, LangConfig> = {
  // JavaScript / TypeScript
  ".js": { parser: JavaScript, scmFile: "javascript-tags.scm" },
  ".jsx": { parser: JavaScript, scmFile: "javascript-tags.scm" },
  ".mjs": { parser: JavaScript, scmFile: "javascript-tags.scm" },
  ".cjs": { parser: JavaScript, scmFile: "javascript-tags.scm" },
  ".ts": { parser: TypeScript, scmFile: "typescript-tags.scm" },
  ".tsx": { parser: TSX, scmFile: "typescript-tags.scm" },
  // Python / Go / Rust / Java
  ".py": { parser: Python, scmFile: "python-tags.scm" },
  ".go": { parser: Go, scmFile: "go-tags.scm" },
  ".rs": { parser: Rust, scmFile: "rust-tags.scm" },
  ".java": { parser: Java, scmFile: "java-tags.scm" },
  // C / C++
  ".c": { parser: C, scmFile: "c-tags.scm" },
  ".h": { parser: C, scmFile: "c-tags.scm" },
  ".cpp": { parser: Cpp, scmFile: "cpp-tags.scm" },
  ".cc": { parser: Cpp, scmFile: "cpp-tags.scm" },
  ".cxx": { parser: Cpp, scmFile: "cpp-tags.scm" },
  ".hpp": { parser: Cpp, scmFile: "cpp-tags.scm" },
  // C#
  ".cs": { parser: CSharp, scmFile: "csharp-tags.scm" },
  // PHP — tree-sitter-php exports { php, php_only }, use php (includes HTML)
  ".php": { parser: PHP.php, scmFile: "php-tags.scm" },
  // Ruby
  ".rb": { parser: Ruby, scmFile: "ruby-tags.scm" },
  // Kotlin
  // ".kt": { parser: Kotlin, scmFile: "kotlin-tags.scm" }, // removed
  // ".kts": { parser: Kotlin, scmFile: "kotlin-tags.scm" }, // removed
};

// ── Skip patterns ──

const SKIP_PATTERNS = [
  /node_modules/,
  /\.git\//,
  /dist\//,
  /build\//,
  /\.next\//,
  /\.nuxt\//,
  /coverage\//,
  /\.cache\//,
  /vendor\//,
  /__pycache__\//,
  /\.venv\//,
  /\.env$/,
  /\.env\..*/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /bun\.lockb$/,
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.ico$/,
  /\.png$/,
  /\.jpg$/,
  /\.jpeg$/,
  /\.gif$/,
  /\.svg$/,
  /\.webp$/,
  /\.mp[34]$/,
  /\.wav$/,
  /\.pdf$/,
  /\.zip$/,
  /\.tar$/,
  /\.gz$/,
  /\.wasm$/,
  /\.pyc$/,
  /\.class$/,
  /\.o$/,
  /\.so$/,
  /\.dll$/,
  /\.exe$/,
  /\.DS_Store$/,
];

const MAX_FILE_SIZE = 100 * 1024; // 100KB
const MAX_FILES = 3000; // Safety cap for monorepos
const BATCH_SIZE = 10;
const BATCH_DELAY_MS = 200;
const CHARS_PER_TOKEN = 4;
const DEFAULT_MAP_TOKENS = 4096;

// ── Query cache ──

const queryCache = new Map<string, string>();

/**
 * Load a .scm query file and strip unsupported predicates for Node.js tree-sitter.
 * Strips: #strip!, #select-adjacent!, #set-adjacent! and their enclosing (comment)* @doc blocks.
 * Keeps: #not-eq?, #not-match? (natively supported).
 */
function loadQuerySCM(scmFile: string): string {
  if (queryCache.has(scmFile)) return queryCache.get(scmFile)!;

  const scmPath = path.join(__dirname, "queries", scmFile);
  let content = fs.readFileSync(scmPath, "utf-8");

  // Remove lines with unsupported predicates
  content = content
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      return (
        !trimmed.startsWith("(#strip!") &&
        !trimmed.startsWith("(#select-adjacent!") &&
        !trimmed.startsWith("(#set-adjacent!")
      );
    })
    .join("\n");

  // Remove (comment)* @doc and the following dot — these are doc comment captures
  // that only make sense with #strip!/#select-adjacent!
  content = content.replace(/\(comment\)\*\s*@doc\s*\.\s*/g, "");

  queryCache.set(scmFile, content);
  return content;
}

// ── Helpers ──

export function shouldSkip(filePath: string): boolean {
  return SKIP_PATTERNS.some((p) => p.test(filePath));
}

export function getExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface TreeEntry {
  path: string;
  type: string;
  size?: number;
  sha: string;
}

// ── Tag extraction ──

/**
 * Extract tags from a single file using tree-sitter.
 * Returns def and ref tags. If the .scm query only yields defs,
 * falls back to regex identifier scan for refs (like Aider's pygments fallback).
 */
export function extractTags(filePath: string, content: string): Tag[] {
  const ext = getExtension(filePath);
  const langConfig = LANG_MAP[ext];
  if (!langConfig) return [];

  let scmContent: string;
  try {
    scmContent = loadQuerySCM(langConfig.scmFile);
  } catch {
    return [];
  }

  const parser = new Parser();
  parser.setLanguage(langConfig.parser);

  let tree: Parser.Tree;
  try {
    tree = parser.parse(content);
  } catch {
    return [];
  }

  let query: Parser.Query;
  try {
    query = new Parser.Query(langConfig.parser, scmContent);
  } catch (err: any) {
    console.warn(
      `[Indexer] Query compile failed for ${filePath}: ${err.message?.substring(0, 100)}`,
    );
    return [];
  }

  const captures = query.captures(tree.rootNode);
  const tags: Tag[] = [];
  let sawDef = false;
  let sawRef = false;

  for (const capture of captures) {
    const captureName: string = capture.name;

    if (captureName.startsWith("name.definition.")) {
      sawDef = true;
      const kind = captureName.replace("name.definition.", "");
      tags.push({
        path: filePath,
        name: capture.node.text,
        kind: "def",
        line: capture.node.startPosition.row,
      });
    } else if (captureName.startsWith("name.reference.")) {
      sawRef = true;
      tags.push({
        path: filePath,
        name: capture.node.text,
        kind: "ref",
        line: capture.node.startPosition.row,
      });
    }
  }

  // If we got defs but no refs, fall back to regex identifier scan
  // (like Aider's pygments fallback for languages like C++ where .scm only has defs)
  if (sawDef && !sawRef) {
    const identRegex = /\b[a-zA-Z_][a-zA-Z0-9_]*\b/g;
    let match: RegExpExecArray | null;
    while ((match = identRegex.exec(content)) !== null) {
      tags.push({
        path: filePath,
        name: match[0],
        kind: "ref",
        line: -1,
      });
    }
  }

  return tags;
}

// ── Graph building ──

export interface GraphData {
  definitions: StoredDefinition[];
  edges: StoredEdge[];
}

/**
 * Build a dependency graph from tags, following Aider's approach:
 * - Edges go from referencer file → definer file
 * - Weight multipliers for identifier quality
 * - Returns definitions + compressed edge list for storage
 */
export function buildGraph(allTags: Tag[]): GraphData {
  // Collect defines and references per identifier
  const defines = new Map<string, Set<string>>(); // ident → set of file paths
  const references = new Map<string, string[]>(); // ident → list of file paths (with dupes for counting)
  const definitions = new Map<string, Set<Tag>>(); // (path, ident) → set of def tags

  for (const tag of allTags) {
    if (tag.kind === "def") {
      if (!defines.has(tag.name)) defines.set(tag.name, new Set());
      defines.get(tag.name)!.add(tag.path);

      const key = `${tag.path}::${tag.name}`;
      if (!definitions.has(key)) definitions.set(key, new Set());
      definitions.get(key)!.add(tag);
    } else if (tag.kind === "ref") {
      if (!references.has(tag.name)) references.set(tag.name, []);
      references.get(tag.name)!.push(tag.path);
    }
  }

  // If no references found, use defines as references (fallback)
  if (references.size === 0) {
    for (const [ident, paths] of defines) {
      references.set(ident, Array.from(paths));
    }
  }

  // Find identifiers that are both defined and referenced
  const idents = new Set<string>();
  for (const ident of defines.keys()) {
    if (references.has(ident)) idents.add(ident);
  }

  // Build edge map: (source, target) → total weight
  const edgeMap = new Map<string, number>();

  // Self-edges for defs with no references (Aider does this)
  for (const [ident, definers] of defines) {
    if (references.has(ident)) continue;
    for (const definer of definers) {
      const key = `${definer}::${definer}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + 0.1);
    }
  }

  for (const ident of idents) {
    const definers = defines.get(ident)!;

    // Aider's weight multipliers
    let mul = 1.0;
    const isSnake = ident.includes("_") && /[a-zA-Z]/.test(ident);
    const isKebab = ident.includes("-") && /[a-zA-Z]/.test(ident);
    const isCamel = /[A-Z]/.test(ident) && /[a-z]/.test(ident);
    if ((isSnake || isKebab || isCamel) && ident.length >= 8) mul *= 10;
    if (ident.startsWith("_")) mul *= 0.1;
    if (definers.size > 5) mul *= 0.1;

    // Count references per file
    const refCounts = new Map<string, number>();
    for (const refPath of references.get(ident)!) {
      refCounts.set(refPath, (refCounts.get(refPath) || 0) + 1);
    }

    for (const [referencer, numRefs] of refCounts) {
      for (const definer of definers) {
        const weight = mul * Math.sqrt(numRefs);
        const key = `${referencer}::${definer}`;
        edgeMap.set(key, (edgeMap.get(key) || 0) + weight);
      }
    }
  }

  // Convert to stored formats
  const storedDefs: StoredDefinition[] = [];
  const seenDefs = new Set<string>();
  for (const [key, tagSet] of definitions) {
    for (const tag of tagSet) {
      const dedupKey = `${tag.path}:${tag.name}:${tag.line}`;
      if (seenDefs.has(dedupKey)) continue;
      seenDefs.add(dedupKey);

      // Extract kind from the tag's context (we stored it as "def" but want the specific type)
      storedDefs.push({
        path: tag.path,
        name: tag.name,
        line: tag.line,
        kind: "def",
        pageRankScore: 0,
      });
    }
  }

  const storedEdges: StoredEdge[] = [];
  for (const [key, weight] of edgeMap) {
    const [source, target] = key.split("::");
    storedEdges.push({ source, target, weight });
  }

  return { definitions: storedDefs, edges: storedEdges };
}

// ── PageRank ──

/**
 * Run PageRank on the graph edges with optional personalization.
 * Returns file paths ranked by importance.
 */
export function runPageRank(
  edges: StoredEdge[],
  allFiles: string[],
  personalizedFiles?: string[],
): Map<string, number> {
  const graph: any = new MultiDirectedGraph();

  // Add all files as nodes
  for (const f of allFiles) {
    if (!graph.hasNode(f)) graph.addNode(f);
  }

  // Add edges
  for (const edge of edges) {
    if (!graph.hasNode(edge.source)) graph.addNode(edge.source);
    if (!graph.hasNode(edge.target)) graph.addNode(edge.target);
    graph.addEdge(edge.source, edge.target, { weight: edge.weight });
  }

  if (graph.order === 0) return new Map();

  // Personalization: add high-weight self-edges to boosted nodes
  // This biases PageRank toward files mentioned in the PR diff
  if (personalizedFiles && personalizedFiles.length > 0) {
    const boost = 100 / Math.max(allFiles.length, 1);
    for (const f of personalizedFiles) {
      if (graph.hasNode(f)) {
        graph.addEdge(f, f, { weight: boost * 50 });
      }
    }
  }

  // Run PageRank
  const ranks: Record<string, number> = pagerank(graph, {
    alpha: 0.85,
    maxIterations: 100,
    tolerance: 1e-6,
    getEdgeWeight: "weight",
  });

  // Convert to Map
  const result = new Map<string, number>();
  for (const [node, rank] of Object.entries(ranks)) {
    result.set(node, rank);
  }

  return result;
}

// ── Map generation ──

/**
 * Generate a compact text repo map from ranked tags.
 * Format:
 *   path/to/file.ts:
 *   │ class ClassName
 *   │   methodName
 *   │ function functionName
 *   │ interface InterfaceName
 */
export function generateRepoMap(
  rankedFiles: string[],
  definitions: StoredDefinition[],
  maxTokens: number = DEFAULT_MAP_TOKENS,
): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;

  // Group definitions by file
  const defsByFile = new Map<string, StoredDefinition[]>();
  for (const def of definitions) {
    if (!defsByFile.has(def.path)) defsByFile.set(def.path, []);
    defsByFile.get(def.path)!.push(def);
  }

  // Sort defs within each file by line number
  for (const [, defs] of defsByFile) {
    defs.sort((a, b) => a.line - b.line);
  }

  let output = "";

  for (const filePath of rankedFiles) {
    const defs = defsByFile.get(filePath);

    let fileBlock = "";
    if (defs && defs.length > 0) {
      fileBlock = `\n${filePath}:\n`;
      for (const def of defs) {
        // Truncate long lines
        const line = `│ ${def.name}\n`;
        fileBlock += line.length > 100 ? line.substring(0, 100) + "\n" : line;
      }
    } else {
      fileBlock = `\n${filePath}\n`;
    }

    if (output.length + fileBlock.length > maxChars) break;
    output += fileBlock;
  }

  return output.trim() + "\n";
}

// ── Main indexer ──

export async function runIndexer(opts: IndexerOptions): Promise<IndexerResult> {
  const start = Date.now();
  const errors: string[] = [];
  let indexedFiles = 0;
  let skippedFiles = 0;

  // 1. Fetch file tree
  const treeRes = await githubAppFetch(
    `/repos/${opts.repoFullName}/git/trees/${opts.headSha}?recursive=1`,
    opts.installationToken,
  );

  if (!treeRes.ok) {
    throw new Error(`Failed to fetch tree: ${treeRes.status}`);
  }

  const treeData = (await treeRes.json()) as {
    tree: TreeEntry[];
    truncated: boolean;
  };

  // Filter to eligible files
  const eligibleFiles = treeData.tree.filter((entry) => {
    if (entry.type !== "blob") return false;
    if (shouldSkip(entry.path)) return false;
    if (entry.size && entry.size > MAX_FILE_SIZE) return false;
    return true;
  });

  // Cap for monorepos
  const filesToProcess = eligibleFiles.slice(0, MAX_FILES);
  const fileTree = filesToProcess.map((f) => f.path);

  console.log(
    `[Indexer] ${opts.repoFullName}: ${filesToProcess.length} files to process (${treeData.tree.length} total in tree)`,
  );

  // 2. Fetch file contents and extract tags
  const allTags: Tag[] = [];

  for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
    const batch = filesToProcess.slice(i, i + BATCH_SIZE);
    if (i > 0) await sleep(BATCH_DELAY_MS);

    const results = await Promise.allSettled(
      batch.map(async (entry) => {
        const ext = getExtension(entry.path);
        if (!LANG_MAP[ext]) {
          // Not a supported language — still include in file tree but skip parsing
          skippedFiles++;
          return null;
        }

        try {
          const contentRes = await githubAppFetch(
            `/repos/${opts.repoFullName}/contents/${encodeURIComponent(entry.path)}?ref=${opts.headSha}`,
            opts.installationToken,
            { headers: { Accept: "application/vnd.github.raw+json" } },
          );

          if (!contentRes.ok) {
            skippedFiles++;
            return null;
          }

          const content = await contentRes.text();
          if (!content.trim()) {
            skippedFiles++;
            return null;
          }

          const tags = extractTags(entry.path, content);
          indexedFiles++;
          return tags;
        } catch (err: any) {
          errors.push(`${entry.path}: ${err.message}`);
          skippedFiles++;
          return null;
        }
      }),
    );

    for (const r of results) {
      if (r.status === "fulfilled" && r.value) {
        allTags.push(...r.value);
      }
    }
  }

  console.log(
    `[Indexer] ${opts.repoFullName}: extracted ${allTags.length} tags from ${indexedFiles} files`,
  );

  // 3. Build graph
  const graphData = buildGraph(allTags);

  console.log(
    `[Indexer] ${opts.repoFullName}: ${graphData.definitions.length} definitions, ${graphData.edges.length} edges`,
  );

  // 4. Run un-personalized PageRank for static map
  const ranks = runPageRank(graphData.edges, fileTree);

  // Add pageRankScore to each definition
  for (const def of graphData.definitions) {
    def.pageRankScore = ranks.get(def.path) ?? 0;
  }

  // Sort files by rank (descending)
  const rankedFiles = [...fileTree].sort((a, b) => {
    return (ranks.get(b) || 0) - (ranks.get(a) || 0);
  });

  // 5. Generate static repo map
  const repoMap = generateRepoMap(rankedFiles, graphData.definitions);

  console.log(
    `[Indexer] ${opts.repoFullName}: generated repo map (${repoMap.length} chars, ~${Math.round(repoMap.length / CHARS_PER_TOKEN)} tokens)`,
  );

  // 6. Store in RepoContext
  let ctx = await RepoContext.findOne({ repoId: opts.repoId });
  if (!ctx) {
    ctx = new RepoContext({ repoId: opts.repoId });
  }

  ctx.repoMap = repoMap;
  ctx.fileTree = fileTree;
  ctx.definitions = graphData.definitions;
  ctx.graphEdges = graphData.edges;

  await ctx.save();

  return {
    totalFiles: eligibleFiles.length,
    indexedFiles,
    skippedFiles,
    errors,
    durationMs: Date.now() - start,
  };
}
