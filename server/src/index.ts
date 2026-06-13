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

if (config.isProduction) {
  app.set("trust proxy", 1);
}

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self)");
  if (config.isProduction) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  next();
});

app.use(
  cors({
    origin: config.corsOrigins,
  })
);

const store = new PresenceStore(config.presenceTtlMs);

app.get("/health", (_req, res) => {
  try {
    if (config.isProduction) {
      res.json({ status: "ok" });
      return;
    }
    res.json({ status: "ok", activeUsers: store.active().length });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Health check failed:", err);
    res.status(500).json({ status: "error" });
  }
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

const connectionsByIp = new Map<string, number>();

function clientIp(socket: { handshake: { address: string } }): string {
  return socket.handshake.address;
}

function removePresence(publicId: string): void {
  try {
    if (store.remove(publicId)) {
      io.emit("presence:remove", { publicId });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to remove presence:", err);
  }
}

io.on("connection", (socket) => {
  const ip = clientIp(socket);
  const activeForIp = (connectionsByIp.get(ip) ?? 0) + 1;
  if (activeForIp > config.maxConnectionsPerIp) {
    socket.emit("error:notice", {
      code: "connection_limited",
      message: "Too many connections from this network.",
    });
    socket.disconnect(true);
    return;
  }
  connectionsByIp.set(ip, activeForIp);

  const publicId = randomUUID();
  socket.data.publicId = publicId;
  socket.data.lastUpdateAt = 0;

  socket.emit("presence:self", { publicId });
  socket.emit("presence:init", store.active());

  socket.on("location:update", (payload) => {
    const now = Date.now();

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

    try {
      const record = store.upsert(publicId, result.value, now);
      socket.data.lastUpdateAt = now;
      io.emit("presence:upsert", record);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Location update failed:", err);
      socket.emit("error:notice", {
        code: "internal_error",
        message: "Failed to update location.",
      });
    }
  });

  socket.on("location:stop", () => {
    removePresence(publicId);
  });

  socket.on("disconnect", () => {
    const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
    if (remaining <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, remaining);

    removePresence(publicId);
  });
});

const sweepTimer = setInterval(() => {
  try {
    const expired = store.sweepExpired();
    for (const publicId of expired) {
      io.emit("presence:remove", { publicId });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Presence sweep failed:", err);
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
