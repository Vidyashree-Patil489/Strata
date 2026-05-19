import mongoose, { Schema, Document, Types } from "mongoose";

export type IndexStatus = "idle" | "indexing" | "ready" | "failed";

export interface IStoredDefinition {
  path: string;
  name: string;
  line: number;
  kind: string;
  pageRankScore: number;
}

export interface IStoredEdge {
  source: string;
  target: string;
  weight: number;
}

/**
 * Per-convention citation. Lets the Forensics page show:
 *   "We extracted this convention from these specific files,
 *    using this exact prompt, costing $X via model Y."
 */
export interface IConventionDetail {
  text: string;
  sourceFiles: string[]; // file paths the LLM saw
  llmUsageId?: Types.ObjectId; // FK into LLMUsage for prompt/cost
  category?: string; // e.g. "naming", "error-handling", etc.
}

/**
 * Per-history-summary citation. The summary string, plus which merged PRs
 * the LLM was shown when extracting that theme.
 */
export interface IHistorySummaryDetail {
  text: string;
  sourcePRs: number[]; // PR numbers the LLM saw
  llmUsageId?: Types.ObjectId;
}

export interface IRepoContext extends Document {
  repoId: Types.ObjectId;
  repoMap: string;
  fileTree: string[];
  definitions: IStoredDefinition[];
  graphEdges: IStoredEdge[];

  // ── Legacy flat shape — always populated, what existing readers use. ──
  conventions: string[];
  recentHistory: string[];

  // ── Grounded shape — populated on new index runs alongside the flat one.
  // May be empty for older RepoContext docs from before this field existed.
  conventionsDetailed: IConventionDetail[];
  recentHistoryDetailed: IHistorySummaryDetail[];

  recentChangedFiles: string[];
  lastIndexedAt: Date | null;
  indexStatus: IndexStatus;
  createdAt: Date;
  updatedAt: Date;
}

const storedDefinitionSchema = new Schema<IStoredDefinition>(
  {
    path: { type: String, required: true },
    name: { type: String, required: true },
    line: { type: Number, required: true },
    kind: { type: String, required: true },
    pageRankScore: { type: Number, default: 0 },
  },
  { _id: false },
);

const storedEdgeSchema = new Schema<IStoredEdge>(
  {
    source: { type: String, required: true },
    target: { type: String, required: true },
    weight: { type: Number, required: true },
  },
  { _id: false },
);

const conventionDetailSchema = new Schema<IConventionDetail>(
  {
    text: { type: String, required: true },
    sourceFiles: { type: [String], default: [] },
    llmUsageId: { type: Schema.Types.ObjectId, ref: "LLMUsage" },
    category: { type: String },
  },
  { _id: false },
);

const historySummaryDetailSchema = new Schema<IHistorySummaryDetail>(
  {
    text: { type: String, required: true },
    sourcePRs: { type: [Number], default: [] },
    llmUsageId: { type: Schema.Types.ObjectId, ref: "LLMUsage" },
  },
  { _id: false },
);

const repoContextSchema = new Schema<IRepoContext>(
  {
    repoId: {
      type: Schema.Types.ObjectId,
      ref: "Repo",
      required: true,
      unique: true,
      index: true,
    },
    repoMap: { type: String, default: "" },
    fileTree: { type: [String], default: [] },
    definitions: { type: [storedDefinitionSchema], default: [] },
    graphEdges: { type: [storedEdgeSchema], default: [] },
    conventions: { type: [String], default: [] },
    recentHistory: { type: [String], default: [] },
    conventionsDetailed: { type: [conventionDetailSchema], default: [] },
    recentHistoryDetailed: { type: [historySummaryDetailSchema], default: [] },
    recentChangedFiles: { type: [String], default: [] },
    lastIndexedAt: { type: Date, default: null },
    indexStatus: {
      type: String,
      enum: ["idle", "indexing", "ready", "failed"],
      default: "idle",
    },
  },
  { timestamps: true },
);

export const RepoContext = mongoose.model<IRepoContext>(
  "RepoContext",
  repoContextSchema,
);
