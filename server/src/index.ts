import { randomUUID } from "node:crypto";
import http from "node:http";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  validateLocationUpdate,
} from "@safesips/shared";
import { config } from "./config.js";
import { PresenceStore } from "./presenceStore.js";

interface SocketData {
  publicId: string;
  lastUpdateAt: number;
}

const app = express();

// HTTPS/WSS is terminated by the platform/reverse proxy in production; trust it
// so secure cookies and protocol detection behave correctly.
if (config.isProduction) {
  app.set("trust proxy", 1);
}

app.use(
  cors({
    origin: config.corsOrigins,
  })
);

app.get("/health", (_req, res) => {
  res.json({ status: "ok", activeUsers: store.active().length });
});

const httpServer = http.createServer(app);

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>(httpServer, {
  cors: {
    origin: config.corsOrigins,
    methods: ["GET", "POST"],
  },
});

const store = new PresenceStore(config.presenceTtlMs);

io.on("connection", (socket) => {
  const publicId = randomUUID();
  socket.data.publicId = publicId;
  socket.data.lastUpdateAt = 0;

  // Tell the client its anonymous id and the current world state.
  socket.emit("presence:self", { publicId });
  socket.emit("presence:init", store.active());

  socket.on("location:update", (payload) => {
    const now = Date.now();

    // Rate limit: reject updates that arrive too frequently.
    if (now - socket.data.lastUpdateAt < config.minUpdateIntervalMs) {
      socket.emit("error:notice", {
        code: "rate_limited",
        message: "Too many location updates. Please slow down.",
      });
      return;
    }

    const result = validateLocationUpdate(payload);
    if (!result.ok || !result.value) {
      socket.emit("error:notice", {
        code: "invalid_payload",
        message: result.error ?? "Invalid location payload.",
      });
      return;
    }

    socket.data.lastUpdateAt = now;

    // Only the masked center is stored and broadcast.
    const record = store.upsert(publicId, result.value, now);
    io.emit("presence:upsert", record);
  });

  socket.on("location:stop", () => {
    if (store.remove(publicId)) {
      io.emit("presence:remove", { publicId });
    }
  });

  socket.on("disconnect", () => {
    if (store.remove(publicId)) {
      io.emit("presence:remove", { publicId });
    }
  });
});

// Periodically remove stale records and notify clients.
const sweepTimer = setInterval(() => {
  const expired = store.sweepExpired();
  for (const publicId of expired) {
    io.emit("presence:remove", { publicId });
  }
}, config.sweepIntervalMs);
sweepTimer.unref?.();

httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `SafeSips presence server listening on :${config.port} ` +
      `(ttl=${config.presenceTtlMs}ms, rate=${config.minUpdateIntervalMs}ms)`
  );
});

function shutdown() {
  clearInterval(sweepTimer);
  io.close();
  httpServer.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
