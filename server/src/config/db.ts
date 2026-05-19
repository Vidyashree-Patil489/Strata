import mongoose from "mongoose";

export async function connectDB(): Promise<void> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    console.error("[DB] MONGODB_URI is not set — skipping connection");
    return;
  }

  mongoose.connection.on("connected", () => {
    console.log("[DB] MongoDB connected");
  });

  mongoose.connection.on("error", (err) => {
    console.error("[DB] MongoDB connection error:", err.message);
  });

  mongoose.connection.on("disconnected", () => {
    console.warn("[DB] MongoDB disconnected");
  });

  try {
    await mongoose.connect(uri, { maxPoolSize: 25 });
  } catch (err) {
    console.error("[DB] Initial connection failed:", err);
    process.exit(1);
  }
}
