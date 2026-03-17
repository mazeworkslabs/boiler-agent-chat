"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { refreshAccessToken } from "@/lib/auth-client";

export interface WSMessage {
  type: string;
  [key: string]: unknown;
}

interface UseWebSocketOptions {
  onMessage?: (msg: WSMessage) => void;
}

export function useWebSocket(options: UseWebSocketOptions = {}) {
  const wsRef = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const connectRef = useRef<() => void>(() => {});
  const queuedMessagesRef = useRef<WSMessage[]>([]);
  // Store onMessage in a ref so we never re-create connect/send
  const onMessageRef = useRef(options.onMessage);
  useEffect(() => {
    onMessageRef.current = options.onMessage;
  }, [options.onMessage]);

  const connect = useCallback(() => {
    // Don't reconnect if already open or connecting
    if (
      wsRef.current?.readyState === WebSocket.OPEN ||
      wsRef.current?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setConnected(true);
      while (queuedMessagesRef.current.length > 0) {
        const nextMessage = queuedMessagesRef.current.shift();
        if (!nextMessage) continue;
        ws.send(JSON.stringify(nextMessage));
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSMessage;
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      onMessageRef.current?.(msg);
    };

    ws.onclose = (event) => {
      setConnected(false);
      wsRef.current = null;

      const reconnect = async () => {
        if (event.code === 4001) {
          const refreshed = await refreshAccessToken();
          if (!refreshed) return;
        }
        connectRef.current();
      };

      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        void reconnect();
      }, 3000);
    };

    wsRef.current = ws;
  }, []); // No dependencies — stable forever

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return;
    }
    queuedMessagesRef.current.push(msg);
    connectRef.current();
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { connect, send, connected };
}
