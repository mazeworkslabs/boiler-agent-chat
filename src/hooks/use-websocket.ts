"use client";

import { useRef, useState, useCallback, useEffect } from "react";

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
  // Store onMessage in a ref so we never re-create connect/send
  const onMessageRef = useRef(options.onMessage);
  onMessageRef.current = options.onMessage;

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
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WSMessage;
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }
      onMessageRef.current?.(msg);
    };

    ws.onclose = () => {
      setConnected(false);
      wsRef.current = null;
      // Reconnect after 3 seconds
      reconnectTimeoutRef.current = setTimeout(connect, 3000);
    };

    wsRef.current = ws;
  }, []); // No dependencies — stable forever

  const send = useCallback((msg: WSMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(reconnectTimeoutRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { connect, send, connected };
}
