import "dotenv/config";
import { createServer } from "http";
import next from "next";
import express from "express";
import { createWSServer } from "./server/ws-server";

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const expressApp = express();
  const httpServer = createServer(expressApp);

  // WebSocket server (noServer mode — we route upgrades manually)
  const wss = createWSServer();

  // Route WebSocket upgrades: /ws → our WS server, everything else → Next.js HMR
  httpServer.on("upgrade", (req, socket, head) => {
    if (req.url?.startsWith("/ws")) {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      // Let Next.js handle HMR websocket upgrades
      app.getUpgradeHandler()(req, socket, head);
    }
  });

  // Let Next.js handle all other routes
  expressApp.all("/{*path}", (req, res) => {
    handle(req, res);
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on http://localhost:${port}`);
    console.log(`> WebSocket on ws://localhost:${port}/ws`);
  });
});
