import { Server as SocketServer } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import type { Server as HttpServer } from "http";
import { getSocketPubSub } from "./redis";

let io: SocketServer;

export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL || "http://localhost:5173",
      credentials: true,
    },
  });

  // Cross-instance event fan-out. Without this, an event emitted from API
  // instance A never reaches a client connected to instance B — the running
  // scan banner, agent progress, audit log refresh all silently break under
  // horizontal scaling.
  //
  // The adapter uses Redis pub/sub on a dedicated pair of connections.
  // Falls back to single-instance in-memory routing if REDIS_URL is missing
  // (dev mode without Redis).
  const pubSub = getSocketPubSub();
  if (pubSub) {
    io.adapter(createAdapter(pubSub.pub, pubSub.sub));
    console.log("[Socket] Redis adapter attached — events fan out across instances");
  } else {
    console.warn(
      "[Socket] No REDIS_URL — running in single-instance mode. Multi-instance deployments WILL break real-time updates.",
    );
  }

  io.on("connection", (socket) => {
    console.log(
      `[Socket] Client connected: ${socket.id} (transport: ${socket.conn.transport.name})`,
    );

    // Allow clients to join a user-specific room (with dedup)
    socket.on("join", (userId: string) => {
      if (userId) {
        const room = `user:${userId}`;
        if (!socket.rooms.has(room)) {
          socket.join(room);
          console.log(`[Socket] ${socket.id} joined room ${room}`);
        } else {
          console.log(`[Socket] ${socket.id} already in room ${room}`);
        }
      } else {
        console.warn(`[Socket] ${socket.id} sent join with empty userId`);
      }
    });

    socket.on("disconnect", (reason) => {
      console.log(
        `[Socket] Client disconnected: ${socket.id} (reason: ${reason})`,
      );
    });
  });

  console.log("[Socket] Socket.io initialized");
  return io;
}

export function getIO(): SocketServer {
  if (!io) throw new Error("Socket.io not initialized — call initSocket first");
  return io;
}
