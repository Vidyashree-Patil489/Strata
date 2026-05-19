/**
 * Pattern Extractor Agent
 *
 * Samples representative files from the repo, sends them to the LLM,
 * and extracts coding conventions, patterns, and anti-patterns.
 *
 * Writes BOTH a flat string list (`ctx.conventions`, legacy callers) and
 * a richer grounded list (`ctx.conventionsDetailed`) with the exact files
 * each convention was extracted from, the prompt that was sent, and a
 * link back to the LLMUsage row that records cost.
 */
import { githubAppFetch } from "../../utils/github";
import {
  callLLM,
  type CallLLMOptions,
  computeCost,
  lookupModelPricing,
} from "../../services/ai.service";
import { RepoContext } from "../../models/RepoContext";
import { LLMUsage } from "../../models/LLMUsage";
import type { Types } from "mongoose";

const MAX_SAMPLE_FILES = 20;
const MAX_FILE_CONTENT = 4000;
const RAW_RESPONSE_CAP = 10_000;
const PROMPT_PREVIEW_CAP = 200;

const PRIORITY_PATTERNS = [
  /\.ts$/, /\.tsx$/, /\.js$/, /\.jsx$/, /\.py$/,
  /\.go$/, /\.rs$/, /\.java$/, /\.rb$/,
];

const HIGH_VALUE_PATTERNS = [
  /eslint/i, /prettier/i, /tsconfig/i, /jest\.config/i, /vitest\.config/i,
  /\.editorconfig/i, /Makefile$/, /Dockerfile$/, /docker-compose/i,
];

/**
 * Convention slot index → semantic category. Matches the 10 slots the
 * prompt asks the LLM to fill (1-indexed in the prompt, 0-indexed here).
 */
const CONVENTION_CATEGORIES = [
  "naming-variables",
  "naming-components",
  "naming-files",
  "error-handling",
  "testing",
  "ui-framework",
  "state-management",
  "imports",
  "code-organization",
  "anti-pattern",
];

export interface PatternOptions {
  repoFullName: string;
  headSha: string;
  installationToken: string;
  repoId: Types.ObjectId;
  userId: Types.ObjectId;
  runId: string;
  llmOptions: CallLLMOptions;
}

export interface PatternResult {
  conventions: string[];
  filesAnalyzed: number;
  durationMs: number;
  costUsd: number;
}

export async function runPatternExtractor(
  opts: PatternOptions,
): Promise<PatternResult> {
  const start = Date.now();

  // 1. Fetch file tree
  const treeRes = await githubAppFetch(
    `/repos/${opts.repoFullName}/git/trees/${opts.headSha}?recursive=1`,
    opts.installationToken,
  );
  if (!treeRes.ok) throw new Error(`Failed to fetch tree: ${treeRes.status}`);

  const treeData = (await treeRes.json()) as {
    tree: Array<{ path: string; type: string; size?: number }>;
  };

  const blobs = treeData.tree.filter(
    (e) =>
      e.type === "blob" &&
      !e.path.includes("node_modules") &&
      !e.path.includes(".git/"),
  );

  // 2. Select representative sample
  const highValue = blobs.filter((f) =>
    HIGH_VALUE_PATTERNS.some((p) => p.test(f.path)),
  );
  const sourceFiles = blobs
    .filter((f) => PRIORITY_PATTERNS.some((p) => p.test(f.path)))
    .sort((a, b) => {
      const scoreA = a.size ? Math.abs(a.size - 2000) : 10000;
      const scoreB = b.size ? Math.abs(b.size - 2000) : 10000;
      return scoreA - scoreB;
    });

  const selected = [
    ...highValue.slice(0, 5),
    ...sourceFiles.slice(0, MAX_SAMPLE_FILES - Math.min(highValue.length, 5)),
  ].slice(0, MAX_SAMPLE_FILES);

  console.log(
    `[Patterns] ${opts.repoFullName}: sampling ${selected.length} files`,
  );

  // 3. Fetch content for selected files
  const fileContents: Array<{ path: string; content: string }> = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < selected.length; i++) {
    const file = selected[i];
    if (i > 0 && i % 5 === 0) await sleep(200);
    try {
      const res = await githubAppFetch(
        `/repos/${opts.repoFullName}/contents/${encodeURIComponent(file.path)}?ref=${opts.headSha}`,
        opts.installationToken,
        { headers: { Accept: "application/vnd.github.raw+json" } },
      );
      if (res.ok) {
        const content = await res.text();
        fileContents.push({
          path: file.path,
          content: content.slice(0, MAX_FILE_CONTENT),
        });
      }
    } catch {
      // skip
    }
  }

  // 4. Build prompt + send to LLM
  const filesBlock = fileContents
    .map((f) => `--- ${f.path} ---\n${f.content}`)
    .join("\n\n");

  const prompt = `Analyze these ${fileContents.length} files from a codebase. Extract exactly one convention per slot. Each convention must be a SEPARATE short string (under 30 words). Do NOT merge multiple observations.

Fill ALL 10 slots:
1. Variable/function naming convention
2. Component/class naming convention
3. File naming convention
4. Error handling approach
5. Test framework and test file organization
6. Primary UI framework/library and component structure
7. State management approach
8. Import style (named vs default, aliases, barrel exports)
9. Code organization pattern (folder structure, separation of concerns)
10. One anti-pattern or inconsistency noticed

If a category has no evidence, write "No evidence found" for that slot.

${filesBlock}`;

  const isOpenAI = opts.llmOptions.provider === "openai";
  const conventionItemSchema = {
    type: "string" as const,
    description: "A single coding convention observed in the codebase, under 30 words.",
  };
  const responseSchema = isOpenAI
    ? {
        type: "object" as const,
        properties: {
          conventions: {
            type: "array" as const,
            items: conventionItemSchema,
            description: "Exactly 10 coding conventions, one per category.",
          },
        },
        required: ["conventions"],
        additionalProperties: false,
      }
    : {
        type: "array" as const,
        items: conventionItemSchema,
        minItems: 10,
        maxItems: 10,
        description: "Exactly 10 coding conventions, one per category.",
      };

  const llmStart = Date.now();
  const res = await callLLM(prompt, {
    ...opts.llmOptions,
    systemPrompt:
      "You are a senior code reviewer. Return exactly 10 short convention strings. One per category. Do NOT combine multiple conventions into one string.",
    maxTokens: 2000,
    temperature: 0.2,
    responseSchema,
  });
  const llmDurationMs = Date.now() - llmStart;

  // 5. Record cost + raw response BEFORE parsing, so we keep evidence even
  // if parsing fails downstream.
  //
  // Cost-lookup nuance: use the *requested* model id (opts.llmOptions.model)
  // — that's the bare key the user picked from AVAILABLE_MODELS and matches
  // MODEL_PRICING. The *response* model (res.model) is what providers
  // actually billed against (often date-pinned like "gpt-4.1-mini-2025-04-14")
  // — we keep it on the LLMUsage row for audit but it's the wrong key for
  // a direct pricing lookup.
  const inputTokens = res.usage?.inputTokens ?? 0;
  const outputTokens = res.usage?.outputTokens ?? 0;
  const requestedModel = opts.llmOptions.model;
  const costUsd = computeCost(requestedModel, inputTokens, outputTokens);
  const pricingMatch = lookupModelPricing(requestedModel).match;

  const sampledPaths = fileContents.map((f) => f.path);
  const usageDoc = await LLMUsage.create({
    repoId: opts.repoId,
    userId: opts.userId,
    runId: opts.runId,
    taskType: "pattern_extractor",
    provider: res.provider,
    model: res.model,
    inputTokens,
    outputTokens,
    costUsd,
    pricingMatch,
    durationMs: llmDurationMs,
    promptPreview: prompt.slice(0, PROMPT_PREVIEW_CAP),
    inputs: { filesAnalyzed: sampledPaths },
    rawResponse: (res.content || "").slice(0, RAW_RESPONSE_CAP),
  });

  // 6. Parse conventions
  let conventionsRaw: string[] = [];
  try {
    const cleaned = res.content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) conventionsRaw = parsed;
    else if (parsed.conventions && Array.isArray(parsed.conventions)) conventionsRaw = parsed.conventions;
    else conventionsRaw = [String(parsed)];
  } catch {
    conventionsRaw = res.content
      .split("\n")
      .map((l) => l.replace(/^[-*\d.]\s*/, "").trim())
      .filter((l) => l.length > 10);
  }

  // Drop "No evidence found" while preserving original slot indexes so we
  // can map kept conventions back to their category.
  const conventionsKept: Array<{ text: string; category?: string }> = [];
  conventionsRaw.forEach((text, idx) => {
    if (text.toLowerCase().includes("no evidence found")) return;
    conventionsKept.push({
      text,
      category: CONVENTION_CATEGORIES[idx],
    });
  });

  // 7. Persist BOTH the flat list (legacy readers) and the grounded list.
  let ctx = await RepoContext.findOne({ repoId: opts.repoId });
  if (!ctx) ctx = new RepoContext({ repoId: opts.repoId });

  ctx.conventions = conventionsKept.map((c) => c.text);
  ctx.conventionsDetailed = conventionsKept.map((c) => ({
    text: c.text,
    sourceFiles: sampledPaths,
    llmUsageId: usageDoc._id as any,
    category: c.category,
  }));
  await ctx.save();

  return {
    conventions: ctx.conventions,
    filesAnalyzed: fileContents.length,
    durationMs: Date.now() - start,
    costUsd,
  };
}
