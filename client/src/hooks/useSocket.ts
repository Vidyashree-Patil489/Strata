import { useEffect, useRef, useCallback, useState } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = import.meta.env.VITE_API_URL || "http://localhost:3000";

let globalSocket: Socket | null = null;

function getSocket(): Socket {
  if (!globalSocket) {
    globalSocket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    });

    // Global-level debug logging (fires once, not per-component)
    globalSocket.on("connect", () => {
      console.log("[Socket] Connected:", globalSocket?.id);
    });
    globalSocket.on("disconnect", (reason) => {
      console.log("[Socket] Disconnected:", reason);
    });
    globalSocket.on("connect_error", (err) => {
      console.error("[Socket] Connection error:", err.message);
    });
  }
  return globalSocket;
}

/**
 * Connect to Socket.io and listen for review pipeline events.
 * Joins a user-specific room so events are scoped.
 */
export function useSocket(userId?: string) {
  const socket = useRef<Socket>(getSocket());
  const [connected, setConnected] = useState(socket.current.connected);

  useEffect(() => {
    const s = socket.current;
    if (!s.connected) s.connect();

    const uid = userId || localStorage.getItem("socket_user_id");

    const handleConnect = () => {
      setConnected(true);
      // Join user room for scoped events
      if (uid) {
        console.log("[Socket] Joining room for user:", uid);
        s.emit("join", uid);
      } else {
        console.warn("[Socket] No userId available — cannot join room");
      }
    };

    const handleDisconnect = () => {
      setConnected(false);
    };

    s.on("connect", handleConnect);
    s.on("disconnect", handleDisconnect);

    // If already connected, join immediately
    if (s.connected) {
      handleConnect();
    }

    return () => {
      s.off("connect", handleConnect);
      s.off("disconnect", handleDisconnect);
    };
  }, [userId]);

  const on = useCallback((event: string, handler: (...args: any[]) => void) => {
    socket.current.on(event, handler);
    return () => {
      socket.current.off(event, handler);
    };
  }, []);

  const off = useCallback(
    (event: string, handler: (...args: any[]) => void) => {
      socket.current.off(event, handler);
    },
    [],
  );

  return { socket: socket.current, connected, on, off };
}

// ── Event types ──

export interface ReviewStartedEvent {
  reviewId: string;
  repoFullName: string;
  prNumber: number;
  agents: string[];
}

export interface AgentStartedEvent {
  reviewId: string;
  agentType: string;
  repoFullName: string;
  prNumber: number;
}

export interface AgentCompletedEvent {
  reviewId: string;
  agentType: string;
  findingsCount: number;
  durationMs: number;
}

export interface AgentFailedEvent {
  reviewId: string;
  agentType: string;
  error: string;
}

export interface ReviewCompletedEvent {
  reviewId: string;
  repoFullName: string;
  prNumber: number;
  verdict: string;
  confidenceScore: number;
  findingsCount: number;
}

export interface SynthesizerStartedEvent {
  reviewId: string;
  repoFullName: string;
  prNumber: number;
}
