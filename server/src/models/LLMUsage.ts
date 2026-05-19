import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Per-call LLM usage record. Written every time a context agent
 * (pattern_extractor / history_summarizer) makes an LLM call, so users
 * can see exactly what their indexing run cost them and why.
 *
 * Grouped into "runs" by `runId` — one job processing run = one runId
 * shared across both agents. This lets the UI show "this index cost
 * $0.03 total, broken down as $0.02 patterns + $0.01 history".
 *
 * Retention: 90 days TTL. Cost data older than that is rolled up into
 * monthly summaries elsewhere if needed; the row-level detail is for
 * recent forensic inspection, not long-term analytics.
 */

export type LLMTaskType = "pattern_extractor" | "history_summarizer";

export interface ILLMUsage extends Document {
  repoId: Types.ObjectId;
  userId: Types.ObjectId;
  runId: string; // groups calls from the same index job; UUID per job
  taskType: LLMTaskType;
  provider: string; // "openai" | "gemini" | "anthropic"
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  /**
   * First ~200 chars of the prompt that was sent. Lets the Forensics
   * page show "the LLM was asked: ..." without persisting the entire
   * prompt (which could include large file contents).
   */
  promptPreview: string;
  /**
   * What inputs the agent fed in. Shape varies by taskType.
   * For pattern_extractor: { filesAnalyzed: string[] }
   * For history_summarizer: { prsAnalyzed: number[] }
   */
  inputs: Record<string, any>;
  /**
   * The full raw text the LLM returned (or up to ~10K chars of it).
   * The Forensics page renders this so users can see exactly what the
   * model said vs. what we parsed/stored.
   */
  rawResponse: string;
  createdAt: Date;
}

const llmUsageSchema = new Schema<ILLMUsage>(
  {
    repoId: { type: Schema.Types.ObjectId, ref: "Repo", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    runId:  { type: String, required: true, index: true },
    taskType: {
      type: String,
      enum: ["pattern_extractor", "history_summarizer"],
      required: true,
    },
    provider: { type: String, required: true },
    model:    { type: String, required: true },
    inputTokens:  { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    costUsd:      { type: Number, default: 0 },
    durationMs:   { type: Number, default: 0 },
    promptPreview: { type: String, default: "" },
    inputs:       { type: Schema.Types.Mixed, default: {} },
    rawResponse:  { type: String, default: "" },
    createdAt:    { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// TTL: drop records older than 90 days
llmUsageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 86400 });
// Common query: "all usage for this repo, newest first"
llmUsageSchema.index({ repoId: 1, createdAt: -1 });
// Common query: "all usage for this user this month"
llmUsageSchema.index({ userId: 1, createdAt: -1 });

export const LLMUsage = mongoose.model<ILLMUsage>("LLMUsage", llmUsageSchema);
