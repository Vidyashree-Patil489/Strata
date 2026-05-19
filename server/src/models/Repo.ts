import mongoose, { Schema, Document, Types } from "mongoose";

export interface IRepoSettings {
  autoIndex: boolean;
  aiProvider?: string;
  aiModel?: string;
}

export interface IRepo extends Document {
  owner: string;
  name: string;
  fullName: string;
  githubRepoId: number;
  connectedBy: Types.ObjectId;
  webhookId: number;
  /**
   * True for repos the user added by URL (public repos they don't necessarily own).
   * Indexing for these uses the user's GitHub OAuth token instead of an App
   * installation token, and auto-reindex on push is disabled (no App = no webhooks).
   */
  isPublic: boolean;
  settings: IRepoSettings;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const repoSettingsSchema = new Schema(
  {
    autoIndex: { type: Boolean, default: true },
    aiProvider: { type: String },
    aiModel: { type: String },
  },
  { _id: false },
);

const repoSchema = new Schema<IRepo>(
  {
    owner: { type: String, required: true },
    name: { type: String, required: true },
    fullName: { type: String, required: true, index: true },
    githubRepoId: { type: Number, required: true, unique: true },
    connectedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    webhookId: { type: Number, required: true },
    isPublic: { type: Boolean, default: false, index: true },
    settings: { type: repoSettingsSchema, default: () => ({}) },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

repoSchema.index({ connectedBy: 1, isActive: 1 });

export const Repo = mongoose.model<IRepo>("Repo", repoSchema);
