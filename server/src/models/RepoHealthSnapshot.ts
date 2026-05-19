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
  totalDefinitions: { type: Number, default: 0 },
  totalFiles:       { type: Number, default: 0 },
  prCount:          { type: Number, default: 0 },
  computedAt:       { type: Date, default: Date.now },
}, { timestamps: false });

RepoHealthSnapshotSchema.index({ repoId: 1, computedAt: -1 });

export default mongoose.model<IRepoHealthSnapshot>(
  'RepoHealthSnapshot', RepoHealthSnapshotSchema
);
