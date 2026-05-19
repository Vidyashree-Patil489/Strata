/**
 * History Summarizer Agent
 *
 * Fetches recent closed/merged PRs from the repo, summarizes them with
 * the LLM into themes, and stores both a flat string list (legacy
 * callers) and a grounded list with source PR numbers + an LLMUsage row
 * link, for the Forensics page.
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

const MAX_PRS = 20;
const RAW_RESPONSE_CAP = 10_000;
const PROMPT_PREVIEW_CAP = 200;

interface GitHubPR {
  number: number;
  title: string;
  body: string | null;
  merged_at: string | null;
  user: { login: string };
  labels: Array<{ name: string }>;
}

export interface HistoryOptions {
  repoFullName: string;
  installationToken: string;
  repoId: Types.ObjectId;
  userId: Types.ObjectId;
  runId: string;
  llmOptions: CallLLMOptions;
}

export interface HistoryResult {
  summaries: string[];
  prsAnalyzed: number;
  durationMs: number;
  costUsd: number;
}

export async function runHistorySummarizer(
  opts: HistoryOptions,
): Promise<HistoryResult> {
  const start = Date.now();

  // 1. Fetch recent closed PRs
  const prRes = await githubAppFetch(
    `/repos/${opts.repoFullName}/pulls?state=closed&sort=updated&direction=desc&per_page=${MAX_PRS}`,
    opts.installationToken,
  );
  if (!prRes.ok) throw new Error(`Failed to fetch PRs: ${prRes.status}`);

  const prs = (await prRes.json()) as GitHubPR[];
  const mergedPRs = prs.filter((pr) => pr.merged_at);

  if (mergedPRs.length === 0) {
    let ctx = await RepoContext.findOne({ repoId: opts.repoId });
    if (!ctx) ctx = new RepoContext({ repoId: opts.repoId });
    ctx.recentHistory = ["No recently merged pull requests found."];
    ctx.recentHistoryDetailed = [];
    await ctx.save();
    return { summaries: [], prsAnalyzed: 0, durationMs: Date.now() - start, costUsd: 0 };
  }

  console.log(`[History] ${opts.repoFullName}: summarizing ${mergedPRs.length} merged PRs`);

  // 2. Build prompt
  const prBlock = mergedPRs
    .map((pr) => {
      const labels = pr.labels.map((l) => l.name).join(", ");
      const body = pr.body ? pr.body.slice(0, 500) : "(no description)";
      return `PR #${pr.number}: "${pr.title}" by @${pr.user.login}${labels ? ` [${labels}]` : ""}\nMerged: ${pr.merged_at}\n${body}`;
    })
    .join("\n\n---\n\n");

  const prompt = `Here are the ${mergedPRs.length} most recently merged pull requests for this repository.

Summarize what has changed recently and why. Group related changes together.
Return 5-10 summary strings, each describing a theme or area of recent work.
Each string should be 1-2 sentences, clear and specific.

${prBlock}`;

  const isOpenAI = opts.llmOptions.provider === "openai";
  const summaryItemSchema = {
    type: "string" as const,
    description: "A 1-2 sentence summary of a theme or area of recent work.",
  };
  const responseSchema = isOpenAI
    ? {
        type: "object" as const,
        properties: {
          summaries: {
            type: "array" as const,
            items: summaryItemSchema,
            description: "5-10 summaries of recent development themes.",
          },
        },
        required: ["summaries"],
        additionalProperties: false,
      }
    : {
        type: "array" as const,
        items: summaryItemSchema,
        minItems: 3,
        maxItems: 10,
        description: "5-10 summaries of recent development themes.",
      };

  const llmStart = Date.now();
  const res = await callLLM(prompt, {
    ...opts.llmOptions,
    systemPrompt:
      "You are a technical project analyst. Summarize recent development activity concisely into separate themes.",
    maxTokens: 1500,
    temperature: 0.2,
    responseSchema,
  });
  const llmDurationMs = Date.now() - llmStart;

  // 3. Record cost + raw response BEFORE parsing.
  // See patterns.ts for the rationale on requested-model vs response-model:
  // we use the requested id for cost lookup, keep res.model as audit data.
  const inputTokens = res.usage?.inputTokens ?? 0;
  const outputTokens = res.usage?.outputTokens ?? 0;
  const requestedModel = opts.llmOptions.model;
  const costUsd = computeCost(requestedModel, inputTokens, outputTokens);
  const pricingMatch = lookupModelPricing(requestedModel).match;

  const prNumbers = mergedPRs.map((p) => p.number);
  const usageDoc = await LLMUsage.create({
    repoId: opts.repoId,
    userId: opts.userId,
    runId: opts.runId,
    taskType: "history_summarizer",
    provider: res.provider,
    model: res.model,
    inputTokens,
    outputTokens,
    costUsd,
    pricingMatch,
    durationMs: llmDurationMs,
    promptPreview: prompt.slice(0, PROMPT_PREVIEW_CAP),
    inputs: { prsAnalyzed: prNumbers },
    rawResponse: (res.content || "").slice(0, RAW_RESPONSE_CAP),
  });

  // 4. Parse summaries
  let summaries: string[] = [];
  try {
    const cleaned = res.content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) summaries = parsed;
    else if (parsed.summaries && Array.isArray(parsed.summaries)) summaries = parsed.summaries;
    else summaries = [String(parsed)];
  } catch {
    summaries = res.content
      .split("\n")
      .map((l) => l.replace(/^[-*\d.]\s*/, "").trim())
      .filter((l) => l.length > 10);
  }

  // 5. Persist both flat + grounded
  let ctx = await RepoContext.findOne({ repoId: opts.repoId });
  if (!ctx) ctx = new RepoContext({ repoId: opts.repoId });

  ctx.recentHistory = summaries;
  // Each summary cites the same full set of PRs we sent to the LLM.
  // (We don't ask the LLM to map summary → specific PRs because that
  // would bloat tokens; instead the Forensics page shows "the LLM saw
  // these N PRs and produced these K summaries from them".)
  ctx.recentHistoryDetailed = summaries.map((text) => ({
    text,
    sourcePRs: prNumbers,
    llmUsageId: usageDoc._id as any,
  }));
  await ctx.save();

  return {
    summaries,
    prsAnalyzed: mergedPRs.length,
    durationMs: Date.now() - start,
    costUsd,
  };
}
