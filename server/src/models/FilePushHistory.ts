import mongoose, { Schema, Document } from 'mongoose';

export interface IFilePushHistory extends Document {
  repoId:    mongoose.Types.ObjectId;
  pushedAt:  Date;
  files:     string[];
  commitSha: string;
  fileDiffs?: Array<{
    filename: string;
    additions: number;
    deletions: number;
    patch?: string;
  }>;
}

const FilePushHistorySchema = new Schema<IFilePushHistory>({
  repoId:    { type: Schema.Types.ObjectId, ref: 'Repo', required: true },
  pushedAt:  { type: Date, default: Date.now },
  files:     [{ type: String }],
  commitSha: { type: String, default: '' },
  fileDiffs: [{
    filename: String,
    additions: Number,
    deletions: Number,
    patch: String,
  }],
}, { timestamps: false });

FilePushHistorySchema.index({ pushedAt: 1 }, { expireAfterSeconds: 7776000 });
FilePushHistorySchema.index({ repoId: 1, pushedAt: -1 });

export default mongoose.model<IFilePushHistory>(
  'FilePushHistory', FilePushHistorySchema
);
