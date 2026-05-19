import mongoose, { Schema, Document, Types } from "mongoose";

/**
 * Per-commit snapshot of the repo dependency graph. One row per
 * (repo, commitSha). Used by the Knowledge Graph page to render
 * the codebase shape at any point in time and diff between commits.
 *
 * The data is structural-only (tree-sitter): file nodes + import/
 * reference edges. No LLM cost to produce.
 *
 * Storage shape is chosen to load fast into cytoscape's elements
 * format with zero transformation: { id, label, ... } per node,
 * { source, target, weight } per edge.
 *
 * TTL: 180 days. Historical snapshots older than that get dropped;
 * the "current" snapshot is just whichever has the most recent
 * commitDate, so it never disappears as long as you keep indexing.
 */

export interface IGraphNode {
  /** File path (graph node id) */
  id: string;
  /** Display label — usually just the file basename */
  label: string;
  /** Top-level directory, for compound grouping */
  dir: string;
  /** PageRank score in this snapshot (0..1, sums to 1 across all nodes) */
  pageRank: number;
  /** Definition count in this file at this commit */
  defCount: number;
}

export interface IGraphEdge {
  /** Referencing file path */
  source: string;
  /** Defining file path */
  target: string;
  /** Aider-style weight */
  weight: number;
}

export interface IRepoGraphSnapshot extends Document {
  repoId: Types.ObjectId;
  commitSha: string;
  commitShortSha: string;
  commitDate: Date;
  commitAuthor: string;
  commitMessage: string;
  /** Files added vs prior snapshot (denormalized for fast diff queries) */
  filesAdded: number;
  filesRemoved: number;
  filesChanged: number;
  /** Headline counts so the snapshot list page can render without loading nodes */
  nodeCount: number;
  edgeCount: number;
  nodes: IGraphNode[];
  edges: IGraphEdge[];
  /**
   * "current" = the latest indexed snapshot, freshly recomputed on each
   * normal index job. "historical" = built by the historical-graph job
   * when the user clicks "Build history".
   */
  source: "current" | "historical";
  createdAt: Date;
}

const nodeSchema = new Schema<IGraphNode>(
  {
    id: { type: String, required: true },
    label: { type: String, required: true },
    dir: { type: String, default: "" },
    pageRank: { type: Number, default: 0 },
    defCount: { type: Number, default: 0 },
  },
  { _id: false },
);

const edgeSchema = new Schema<IGraphEdge>(
  {
    source: { type: String, required: true },
    target: { type: String, required: true },
    weight: { type: Number, default: 1 },
  },
  { _id: false },
);

const repoGraphSnapshotSchema = new Schema<IRepoGraphSnapshot>(
  {
    repoId: { type: Schema.Types.ObjectId, ref: "Repo", required: true, index: true },
    commitSha: { type: String, required: true },
    commitShortSha: { type: String, required: true },
    commitDate: { type: Date, required: true },
    commitAuthor: { type: String, default: "" },
    commitMessage: { type: String, default: "" },
    filesAdded: { type: Number, default: 0 },
    filesRemoved: { type: Number, default: 0 },
    filesChanged: { type: Number, default: 0 },
    nodeCount: { type: Number, default: 0 },
    edgeCount: { type: Number, default: 0 },
    nodes: { type: [nodeSchema], default: [] },
    edges: { type: [edgeSchema], default: [] },
    source: { type: String, enum: ["current", "historical"], default: "current" },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

// One snapshot per repo+commit; we update in place if re-indexed.
repoGraphSnapshotSchema.index({ repoId: 1, commitSha: 1 }, { unique: true });
// Common query: list snapshots for a repo, newest commit first
repoGraphSnapshotSchema.index({ repoId: 1, commitDate: -1 });
// TTL: drop snapshots older than 180 days
repoGraphSnapshotSchema.index({ createdAt: 1 }, { expireAfterSeconds: 180 * 86400 });

export const RepoGraphSnapshot = mongoose.model<IRepoGraphSnapshot>(
  "RepoGraphSnapshot",
  repoGraphSnapshotSchema,
);
