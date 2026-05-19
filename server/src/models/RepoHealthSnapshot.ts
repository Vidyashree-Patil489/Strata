import mongoose, { Schema, Document } from 'mongoose';

/**
 * Per-file hot-file detail so the Forensics page can show exactly
 * WHY a file is considered "blast radius" — its PageRank rank, churn
 * frequency, and the underlying numbers behind the verdict.
 */
export interface IHotFileDetail {
  path: string;
  pageRankScore: number;
  pageRankPercentile: number; // 0..100, where this file ranks
  churnPushes: number;        // # of recent pushes that touched this file
  totalRecentPushes: number;  // denominator
}

/**
 * Per-smell detail. A "smell" is a structural anti-pattern derived
 * purely from ctx.definitions + ctx.graphEdges — no extra DB queries,
 * no LLM, no PR data required. Each entry tells the Forensics page
 * exactly which file tripped which heuristic and why.
 */
export type SmellKind =
  | 'god-file'
  | 'dead-file'
  | 'deep-coupling'
  | 'circular-dep';

export type SmellSeverity = 'warning' | 'critical';

export interface ISmellDetail {
  path: string;
  kind: SmellKind;
  severity: SmellSeverity;
  /** Raw metric that triggered the smell — def count, edge count, etc. */
  metric: number;
  /** Human-readable justification rendered verbatim in the UI. */
  evidence: string;
}

/**
 * Per-branch analysis result. Mirrors the smell-detail pattern: derived at
 * score time from RepoContext.branchSnapshot (which is fetched at index
 * time), then persisted on the snapshot for the Forensics page.
 */
export type BranchStatus =
  | 'default'
  | 'active'
  | 'idle'
  | 'stale'
  | 'abandoned'
  | 'unknown';

export type BranchSeverity = 'info' | 'good' | 'warning' | 'critical';

export interface IBranchDetail {
  name: string;
  status: BranchStatus;
  severity: BranchSeverity;
  lastCommitSha: string;
  lastCommitAt: Date | null;
  lastCommitAuthor: string | null;
  daysSinceLastCommit: number | null;
  isDefault: boolean;
  isProtected: boolean;
  hasOpenPR: boolean;
  openPRNumber: number | null;
  evidence: string;
}

/**
 * Per-contributor analysis. Mirrors the branch-detail pattern.
 */
export type ContributorStatus =
  | 'active'
  | 'recent'
  | 'dormant'
  | 'former'
  | 'bot'
  | 'unknown';

export type ContributorSeverity = 'info' | 'good' | 'warning' | 'critical';

export interface IContributorDetail {
  login: string;
  name: string | null;
  avatarUrl: string;
  htmlUrl: string;
  contributions: number;
  contributionPct: number;     // 0..100
  recentCommits: number;
  lastCommitAt: Date | null;
  daysSinceLastCommit: number | null;
  status: ContributorStatus;
  severity: ContributorSeverity;
  isBot: boolean;
  evidence: string;
}

export interface IRepoHealthSnapshot extends Document {
  repoId:            mongoose.Types.ObjectId;
  score:             number;
  signals: {
    coupling:   { gini: number; normalized: number };
    churnRisk:  { hotFileCount: number; normalized: number };
    debt:       { weightedTotal: number; avgPerPR: number; normalized: number };
    confidence: { rollingAvg: number; normalized: number };
  };
  // Legacy flat list — always populated; existing readers use this.
  hotFiles:          string[];
  // Grounded list — populated on new snapshots alongside the flat one.
  // Empty on older snapshots from before this field existed.
  hotFilesDetailed:  IHotFileDetail[];
  // Smells — structural anti-patterns from dependency graph. Top-level
  // (not under `signals`) per spec; empty on snapshots predating this field.
  smells: {
    hitCount:   number;
    normalized: number; // 0..1, fed into composite score
  };
  smellsDetailed:    ISmellDetail[];
  // Branch hygiene — derived from RepoContext.branchSnapshot at score time.
  // Empty on snapshots predating this field or when the GitHub fetch failed.
  branches: {
    total:     number;
    active:    number;
    idle:      number;
    stale:     number;
    abandoned: number;
    fetchedAt: Date | null;
  };
  branchesDetailed:  IBranchDetail[];
  // Contributor analysis — derived from RepoContext.contributorSnapshot at
  // score time. Empty on snapshots predating this field.
  contributors: {
    total:           number;
    activeCount:     number;
    botCount:        number;
    busFactor:       number;     // # of authors covering 50% of commits
    recentWindow:    number;     // commits scanned for activity classification
    totalCommits:    number;     // sum of contributions across all surfaced authors
    fetchedAt:       Date | null;
  };
  contributorsDetailed: IContributorDetail[];
  totalDefinitions:  number;
  totalFiles:        number;
  prCount:           number;
  computedAt:        Date;
}

const hotFileDetailSchema = new Schema<IHotFileDetail>(
  {
    path: { type: String, required: true },
    pageRankScore: { type: Number, default: 0 },
    pageRankPercentile: { type: Number, default: 0 },
    churnPushes: { type: Number, default: 0 },
    totalRecentPushes: { type: Number, default: 0 },
  },
  { _id: false },
);

const smellDetailSchema = new Schema<ISmellDetail>(
  {
    path:     { type: String, required: true },
    kind:     { type: String, required: true },
    severity: { type: String, required: true },
    metric:   { type: Number, default: 0 },
    evidence: { type: String, default: '' },
  },
  { _id: false },
);

const branchDetailSchema = new Schema<IBranchDetail>(
  {
    name:                 { type: String, required: true },
    status:               { type: String, required: true },
    severity:             { type: String, required: true },
    lastCommitSha:        { type: String, default: '' },
    lastCommitAt:         { type: Date, default: null },
    lastCommitAuthor:     { type: String, default: null },
    daysSinceLastCommit:  { type: Number, default: null },
    isDefault:            { type: Boolean, default: false },
    isProtected:          { type: Boolean, default: false },
    hasOpenPR:            { type: Boolean, default: false },
    openPRNumber:         { type: Number, default: null },
    evidence:             { type: String, default: '' },
  },
  { _id: false },
);

const contributorDetailSchema = new Schema<IContributorDetail>(
  {
    login:                { type: String, required: true },
    name:                 { type: String, default: null },
    avatarUrl:            { type: String, default: '' },
    htmlUrl:              { type: String, default: '' },
    contributions:        { type: Number, default: 0 },
    contributionPct:      { type: Number, default: 0 },
    recentCommits:        { type: Number, default: 0 },
    lastCommitAt:         { type: Date, default: null },
    daysSinceLastCommit:  { type: Number, default: null },
    status:               { type: String, required: true },
    severity:             { type: String, required: true },
    isBot:                { type: Boolean, default: false },
    evidence:             { type: String, default: '' },
  },
  { _id: false },
);

const RepoHealthSnapshotSchema = new Schema<IRepoHealthSnapshot>({
  repoId:           { type: Schema.Types.ObjectId, ref: 'Repo', required: true },
  score:            { type: Number, required: true, min: 0, max: 100 },
  signals: {
    coupling:   { gini: Number, normalized: Number },
    churnRisk:  { hotFileCount: Number, normalized: Number },
    debt:       { weightedTotal: Number, avgPerPR: Number, normalized: Number },
    confidence: { rollingAvg: Number, normalized: Number },
  },
  hotFiles:         [{ type: String }],
  hotFilesDetailed: { type: [hotFileDetailSchema], default: [] },
  smells: {
    hitCount:   { type: Number, default: 0 },
    normalized: { type: Number, default: 0 },
  },
  smellsDetailed:   { type: [smellDetailSchema], default: [] },
  branches: {
    total:     { type: Number, default: 0 },
    active:    { type: Number, default: 0 },
    idle:      { type: Number, default: 0 },
    stale:     { type: Number, default: 0 },
    abandoned: { type: Number, default: 0 },
    fetchedAt: { type: Date, default: null },
  },
  branchesDetailed: { type: [branchDetailSchema], default: [] },
  contributors: {
    total:        { type: Number, default: 0 },
    activeCount:  { type: Number, default: 0 },
    botCount:     { type: Number, default: 0 },
    busFactor:    { type: Number, default: 0 },
    recentWindow: { type: Number, default: 0 },
    totalCommits: { type: Number, default: 0 },
    fetchedAt:    { type: Date, default: null },
  },
  contributorsDetailed: { type: [contributorDetailSchema], default: [] },
  totalDefinitions: { type: Number, default: 0 },
  totalFiles:       { type: Number, default: 0 },
  prCount:          { type: Number, default: 0 },
  computedAt:       { type: Date, default: Date.now },
}, { timestamps: false });

RepoHealthSnapshotSchema.index({ repoId: 1, computedAt: -1 });

export default mongoose.model<IRepoHealthSnapshot>(
  'RepoHealthSnapshot', RepoHealthSnapshotSchema
);
