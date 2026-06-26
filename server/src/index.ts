import { randomUUID } from "node:crypto";
import http from "node:http";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { Server } from "socket.io";
import {
  ClientToServerEvents,
  ServerToClientEvents,
  validateLocationUpdate,
} from "@safesips/shared";
import { config } from "./config.js";
import { db } from "./db.js";
import { PresenceStore } from "./presenceStore.js";
import {
  setIo,
  trackUserSocket,
  untrackUserSocket,
  type SocketData,
} from "./realtime.js";
import { verifyToken } from "./auth/tokens.js";
import { findUserById } from "./repos/users.js";
import { purgeOldAttempts } from "./auth/throttle.js";
import { startCheckinScheduler } from "./checkinScheduler.js";
import { authRouter } from "./routes/auth.js";
import { reportsRouter } from "./routes/reports.js";
import { forumRouter } from "./routes/forum.js";
import { safeHavensRouter } from "./routes/safeHavens.js";
import { usersRouter } from "./routes/users.js";
import { sosContactsRouter } from "./routes/sosContacts.js";
import { checkinsRouter } from "./routes/checkins.js";
import { waitlistRouter } from "./routes/waitlist.js";

// Touch the db import so the connection opens + migrations run at boot.
void db;

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
app.use(express.json({ limit: "32kb" }));

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

// REST API.
app.use("/api/auth", authRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/forum", forumRouter);
app.use("/api/safe-havens", safeHavensRouter);
app.use("/api/users", usersRouter);
app.use("/api/sos-contacts", sosContactsRouter);
app.use("/api/checkins", checkinsRouter);
app.use("/api/waitlist", waitlistRouter);

// JSON error handler (4 args → Express treats this as the error middleware).
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled route error:", err);
  if (res.headersSent) return;
  res.status(500).json({ error: "Internal server error." });
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
setIo(io);

// Authenticated handshake: a valid JWT is required to connect at all.
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error("unauthorized"));
      return;
    }
    const verified = verifyToken(token);
    if (!verified) {
      next(new Error("unauthorized"));
      return;
    }
    const user = findUserById(verified.userId);
    if (!user || user.status !== "active") {
      next(new Error("unauthorized"));
      return;
    }
    // Server-side only. NEVER copied into a presence:* payload.
    socket.data.userId = verified.userId;
    next();
  } catch {
    next(new Error("unauthorized"));
  }
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

  // Anonymous, per-connection id. Deliberately NOT derived from userId so that
  // other clients can never tell which account is behind a circle.
  const publicId = randomUUID();
  socket.data.publicId = publicId;
  socket.data.lastUpdateAt = 0;

  // Track the authenticated user's sockets so check-in prompts can reach them.
  trackUserSocket(socket.data.userId, socket.id);

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
      // Only the masked center is stored/broadcast — never the userId.
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

    untrackUserSocket(socket.data.userId, socket.id);
    removePresence(publicId);
  });
});

const sweepTimer = setInterval(() => {
  try {
    const expired = store.sweepExpired();
    for (const publicId of expired) {
      io.emit("presence:remove", { publicId });
    }
    purgeOldAttempts();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Presence sweep failed:", err);
  }
}, config.sweepIntervalMs);
sweepTimer.unref?.();

const checkinTimer = startCheckinScheduler();

httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `SafeSips server listening on :${config.port} ` +
      `(ttl=${config.presenceTtlMs}ms, rate=${config.minUpdateIntervalMs}ms, db=${config.databasePath})`
  );
});

function shutdown() {
  clearInterval(sweepTimer);
  clearInterval(checkinTimer);
  io.close();
  httpServer.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
