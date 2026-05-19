import mongoose, { Schema, Document } from "mongoose";

export interface IAIProviderConfig {
  provider: "anthropic" | "openai" | "gemini";
  apiKey: string; // stored encrypted
  addedAt: Date;
}

export interface IUser extends Document {
  githubId: string;
  username: string;
  avatarUrl: string;
  email: string;
  githubAccessToken: string; // stored encrypted
  githubInstallationId?: number;
  aiConfig: {
    providers: IAIProviderConfig[];
    defaultProvider?: "anthropic" | "openai" | "gemini";
    defaultModel?: string;
  };
  refreshTokens: string[];
  createdAt: Date;
  updatedAt: Date;
}

const aiProviderSchema = new Schema(
  {
    provider: {
      type: String,
      enum: ["anthropic", "openai", "gemini"],
      required: true,
    },
    apiKey: { type: String, required: true },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const userSchema = new Schema<IUser>(
  {
    githubId: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true },
    avatarUrl: { type: String, default: "" },
    email: { type: String, default: "" },
    githubAccessToken: { type: String, required: true },
    githubInstallationId: { type: Number },
    aiConfig: {
      providers: { type: [aiProviderSchema], default: [] },
      defaultProvider: {
        type: String,
        enum: ["anthropic", "openai", "gemini"],
      },
      defaultModel: { type: String },
    },
    refreshTokens: { type: [String], default: [] },
  },
  { timestamps: true },
);

export const User = mongoose.model<IUser>("User", userSchema);
