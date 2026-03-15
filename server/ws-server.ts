import { IncomingMessage } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parse as parseCookie } from "cookie";
import { SessionManager } from "./session-manager";

export function createWSServer(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });
  const sessionManager = new SessionManager();

  wss.on("connection", async (ws: WebSocket, req: IncomingMessage) => {
    // Extract user from cookies
    const cookies = parseCookie(req.headers.cookie || "");
    const accessToken = cookies.access_token;

    if (!accessToken) {
      ws.close(4001, "Unauthorized");
      return;
    }

    // Verify token with Directus
    let userEmail: string;
    try {
      const directusUrl = process.env.DIRECTUS_URL || "https://cms.businessfalkenberg.se";
      const res = await fetch(`${directusUrl}/users/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        ws.close(4001, "Invalid token");
        return;
      }
      const data = await res.json();
      userEmail = data.data.email;
    } catch {
      ws.close(4001, "Auth error");
      return;
    }

    console.log(`[WS] Connected: ${userEmail}`);

    // Heartbeat
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "ping" }));
      }
    }, 30000);

    ws.on("message", async (raw) => {
      try {
        const msg = JSON.parse(raw.toString());

        switch (msg.type) {
          case "new_session":
            await sessionManager.createSession(ws, userEmail);
            break;
          case "chat":
            await sessionManager.handleChat(ws, userEmail, msg.sessionId, msg.content, msg.provider, msg.model, msg.attachments, msg.agentMode);
            break;
          case "abort":
            sessionManager.abortSession(msg.sessionId);
            break;
          case "subscribe":
            await sessionManager.subscribeSession(ws, userEmail, msg.sessionId);
            break;
          case "pong":
            break;
          default:
            ws.send(JSON.stringify({ type: "error", message: `Unknown type: ${msg.type}` }));
        }
      } catch (err) {
        console.error("[WS] Message error:", err);
        ws.send(JSON.stringify({ type: "error", message: "Invalid message" }));
      }
    });

    ws.on("close", () => {
      clearInterval(pingInterval);
      console.log(`[WS] Disconnected: ${userEmail}`);
    });
  });

  return wss;
}
