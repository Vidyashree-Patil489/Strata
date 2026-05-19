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

/**
 * Raw branch info fetched from GitHub at index time. Stored verbatim on
 * RepoContext so health-score-time analysis (branch hygiene classification)
 * can be a pure derivation, parallel to how smells derive from graphEdges.
 */
export interface IBranchInfo {
  name: string;
  sha: string;
  lastCommitAt: Date | null;
  lastCommitAuthor: string | null;
  lastCommitMessage: string | null;
  isDefault: boolean;
  isProtected: boolean;
  hasOpenPR: boolean;
  openPRNumber: number | null;
}

export interface IBranchSnapshot {
  defaultBranch: string;
  branches: IBranchInfo[];
  fetchedAt: Date;
  /** True if we hit GitHub's pagination limit (more branches not fetched). */
  truncated: boolean;
}

/**
 * Per-contributor info fetched from GitHub at index time. Mirrors the
 * IBranchInfo / IBranchSnapshot pattern so score-time analysis remains a
 * pure derivation.
 */
export interface IContributorInfo {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  /** Total commits per GitHub's /contributors endpoint (lifetime). */
  contributions: number;
  /** True if GitHub flagged the account as type=Bot. */
  isBot: boolean;
  /** From the last-N commits scan; null if no recent commits by this author. */
  lastCommitAt: Date | null;
  lastCommitSha: string | null;
  /** # of commits authored within the recent-commits window. */
  recentCommits: number;
}

export interface IContributorSnapshot {
  contributors: IContributorInfo[];
  /** Total commits scanned to determine recent activity. */
  recentWindow: number;
  fetchedAt: Date;
  /** True if we hit pagination limits (more contributors not fetched). */
  truncated: boolean;
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

  // Branch state snapshot — fetched at index time, derived at score time.
  // Empty/null on older RepoContext docs from before this field existed.
  branchSnapshot: IBranchSnapshot | null;

  // Contributor snapshot — same pattern as branches: GitHub fetch at index
  // time, derivation at score time.
  contributorSnapshot: IContributorSnapshot | null;

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

const branchInfoSchema = new Schema<IBranchInfo>(
  {
    name:               { type: String, required: true },
    sha:                { type: String, required: true },
    lastCommitAt:       { type: Date, default: null },
    lastCommitAuthor:   { type: String, default: null },
    lastCommitMessage:  { type: String, default: null },
    isDefault:          { type: Boolean, default: false },
    isProtected:        { type: Boolean, default: false },
    hasOpenPR:          { type: Boolean, default: false },
    openPRNumber:       { type: Number, default: null },
  },
  { _id: false },
);

const branchSnapshotSchema = new Schema<IBranchSnapshot>(
  {
    defaultBranch: { type: String, default: "" },
    branches:      { type: [branchInfoSchema], default: [] },
    fetchedAt:     { type: Date, default: Date.now },
    truncated:     { type: Boolean, default: false },
  },
  { _id: false },
);

const contributorInfoSchema = new Schema<IContributorInfo>(
  {
    login:          { type: String, required: true },
    name:           { type: String, default: null },
    avatarUrl:      { type: String, default: "" },
    htmlUrl:        { type: String, default: "" },
    contributions:  { type: Number, default: 0 },
    isBot:          { type: Boolean, default: false },
    lastCommitAt:   { type: Date, default: null },
    lastCommitSha:  { type: String, default: null },
    recentCommits:  { type: Number, default: 0 },
  },
  { _id: false },
);

const contributorSnapshotSchema = new Schema<IContributorSnapshot>(
  {
    contributors: { type: [contributorInfoSchema], default: [] },
    recentWindow: { type: Number, default: 0 },
    fetchedAt:    { type: Date, default: Date.now },
    truncated:    { type: Boolean, default: false },
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
    branchSnapshot: { type: branchSnapshotSchema, default: null },
    contributorSnapshot: { type: contributorSnapshotSchema, default: null },
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
