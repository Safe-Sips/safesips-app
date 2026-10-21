import { randomUUID } from "node:crypto";
import http, { type IncomingHttpHeaders } from "node:http";
import { clientIpFrom } from "./clientIp.js";
import cors from "cors";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { Server } from "socket.io";
import {
  ClientToServerEvents,
  PUBLIC_RADIUS_METERS,
  ServerToClientEvents,
  validateLocationUpdate,
} from "@safesips/shared";
import { config } from "./config.js";
import { db } from "./db.js";
import { PresenceStore } from "./presenceStore.js";
import { forgetExpiredShares, forgetShare, loadShares, saveShare } from "./presencePersistence.js";
import {
  hasReachedMaxDuration,
  isDeliberateDisconnect,
  pickHandoverSocket,
  resumeDecision,
} from "./presenceLogic.js";
import {
  emitPresenceMine,
  setIo,
  setSharedAreaLookup,
  setUserPresencePurger,
  trackUserSocket,
  userSocketIds,
  untrackUserSocket,
  type SocketData,
} from "./realtime.js";
import { resolveAuthFromToken } from "./auth/clerk.js";
import { purgeOldAttempts } from "./auth/throttle.js";
import { startCheckinScheduler } from "./checkinScheduler.js";
import { authRouter } from "./routes/auth.js";
import { reportsRouter } from "./routes/reports.js";
import { forumRouter } from "./routes/forum.js";
import { safeHavensRouter } from "./routes/safeHavens.js";
import { usersRouter } from "./routes/users.js";
import { contactsRouter } from "./routes/contacts.js";
import { friendsRouter } from "./routes/friends.js";
import { alertsRouter } from "./routes/alerts.js";
import { pushRouter } from "./routes/push.js";
import { checkinsRouter } from "./routes/checkins.js";
import { waitlistRouter } from "./routes/waitlist.js";
import { adminRouter } from "./routes/admin.js";

// Touch the db import so the connection opens + migrations run at boot.
void db;

const app = express();

// Don't advertise the framework (one less fingerprint for an attacker).
app.disable("x-powered-by");

// Render (and other reverse proxies) set X-Forwarded-For; needed for rate limits.
app.set("trust proxy", 1);

// 1. CORS MUST BE AT THE VERY TOP TO HANDLE OPTIONS PREFLIGHT CORRECTLY.
// Only the explicit CORS_ORIGINS allowlist (config refuses wildcards in
// production). Requests without an Origin header (native mobile, curl) are
// unaffected by CORS.
app.use(
  cors({
    origin: config.corsOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  })
);

// 2. Custom Security Headers (After CORS)
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "geolocation=(self)");
  // Any hosted deploy serves over HTTPS only (Render terminates TLS), so pin it.
  // Keyed on the hosted signal, not NODE_ENV, which the free plan doesn't set.
  if (config.isHostedDeploy) {
    res.setHeader(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  next();
});

app.use(express.json({ limit: "32kb" }));

const store = new PresenceStore(config.presenceTtlMs);

/**
 * One active presence circle per authenticated user (latest socket wins).
 * Kept across reconnects so a circle outlives the socket that created it.
 * `holdUntil` is 0 in live mode, otherwise the epoch ms the user chose to
 * share until. `ownerSocketId` is the socket that last published it (used to
 * tell a genuine reload from a second live session). `startedAt` is the epoch
 * ms the share first began and is preserved across reconnects so the max-
 * duration cap measures real wall-clock time.
 */
const activeShareByUserId = new Map<
  string,
  { publicId: string; holdUntil: number; ownerSocketId: string; startedAt: number }
>();

// Shares that were running before this process started (deploy / restart):
// put the circles back. The owner's next connection resumes theirs.
for (const s of loadShares(Date.now())) {
  store.restore({
    publicId: s.publicId,
    lat: s.lat,
    lng: s.lng,
    radiusMeters: PUBLIC_RADIUS_METERS,
    updatedAt: s.updatedAt,
    expiresAt: s.expiresAt,
    status: "active",
  });
  activeShareByUserId.set(s.userId, {
    publicId: s.publicId,
    holdUntil: s.holdUntil,
    ownerSocketId: "",
    startedAt: s.startedAt,
  });
}

app.get("/health", (_req, res) => {
  try {
    const payload: Record<string, unknown> = {
      status: "ok",
      clerkConfigured: Boolean(config.clerkSecretKey),
    };
    // Only for local dev / CI (how many people share is nobody else's business).
    if (config.allowTestToken) {
      payload.activeUsers = store.active().length;
    }
    res.json(payload);
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
app.use("/api/contacts", contactsRouter);
app.use("/api/friends", friendsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/push", pushRouter);
app.use("/api/checkins", checkinsRouter);
app.use("/api/waitlist", waitlistRouter);
app.use("/api/admin", adminRouter);

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

// Authenticated handshake: a valid Clerk (or smoke-test) token is required.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    next(new Error("unauthorized"));
    return;
  }
  void resolveAuthFromToken(token)
    .then((resolved) => {
      if (!resolved.ok) {
        next(new Error("unauthorized"));
        return;
      }
      // Server-side only. NEVER copied into a presence:* payload.
      socket.data.userId = resolved.userId;
      next();
    })
    .catch(() => next(new Error("unauthorized")));
});

const connectionsByIp = new Map<string, number>();

function clientIp(socket: { handshake: { address: string; headers: IncomingHttpHeaders } }): string {
  return clientIpFrom(socket.handshake.headers, socket.handshake.address);
}

/**
 * Remove a circle. `replacing` = another of the user's sockets is taking it
 * over right now, so don't tell their sessions "you have no circle" in between.
 */
function removePresence(publicId: string, userId?: string, replacing = false): void {
  try {
    if (store.remove(publicId)) {
      io.emit("presence:remove", { publicId });
    }
    forgetShare(publicId);
    if (userId && activeShareByUserId.get(userId)?.publicId === publicId) {
      activeShareByUserId.delete(userId);
      if (!replacing) emitPresenceMine(userId, null);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Failed to remove presence:", err);
  }
}

// Account deletion removes the user's circle right away.
setUserPresencePurger((userId) => {
  const existing = activeShareByUserId.get(userId);
  if (existing) removePresence(existing.publicId, userId);
});

// SOS alerts include the user's current circle (masked centre) if sharing.
setSharedAreaLookup((userId) => {
  const share = activeShareByUserId.get(userId);
  const record = share ? store.get(share.publicId, Date.now()) : undefined;
  return record ? { lat: record.lat, lng: record.lng } : null;
});

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
  socket.data.shareStartedAt = 0;

  // Track the authenticated user's sockets so check-in prompts can reach them.
  trackUserSocket(socket.data.userId, socket.id);

  socket.emit("presence:self", { publicId });

  // If this user already has a circle (page refresh, app reopened, another tab),
  // say which one is theirs BEFORE the initial list, so it's never drawn as
  // someone else's grey circle — even while a refreshed page's old connection
  // hasn't closed yet and still owns it.
  const existingShare = activeShareByUserId.get(socket.data.userId);
  const existingRecord = existingShare
    ? store.get(existingShare.publicId, Date.now())
    : undefined;
  if (existingShare && existingRecord) {
    socket.emit("presence:mine", { publicId: existingShare.publicId });
  }
  socket.emit("presence:init", store.active());

  // Hand the circle to this connection (UI shows "Sharing" with a Stop button)
  // only when no other live socket of the user owns it; otherwise the two
  // sessions would fight over it. If that owner is a refreshed page's stale
  // connection, the disconnect handler hands the circle over once it closes.
  {
    const now = Date.now();
    const existing = existingShare;
    const record = existingRecord;
    const ownerConnected = existing
      ? io.sockets.sockets.has(existing.ownerSocketId)
      : false;
    const decision = resumeDecision({
      hasExisting: !!existing,
      recordExists: !!record,
      ownerConnected,
    });
    if (decision === "resume" && existing && record) {
      socket.emit("presence:resume", {
        publicId: existing.publicId,
        lat: record.lat,
        lng: record.lng,
        holdRemainingMs: existing.holdUntil
          ? Math.max(0, existing.holdUntil - now)
          : 0,
      });
    } else if (decision === "clear") {
      activeShareByUserId.delete(socket.data.userId);
    }
  }

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
      const userId = socket.data.userId;
      const existing = activeShareByUserId.get(userId);
      // When the share first began. Preserved across reconnects so the max-
      // duration cap can't be reset by dropping and re-opening the socket.
      const startedAt = existing?.startedAt ?? now;

      if (hasReachedMaxDuration(startedAt, now, config.shareMaxDurationMs)) {
        removePresence(existing?.publicId ?? publicId, userId);
        socket.emit("error:notice", {
          code: "share_expired",
          message: "Location sharing stopped after 24 hours.",
        });
        return;
      }

      const prevPublicId = existing?.publicId;
      if (prevPublicId && prevPublicId !== publicId) {
        removePresence(prevPublicId, userId, true);
      }
      const holdMs = result.value.holdMs ?? 0;
      activeShareByUserId.set(userId, {
        publicId,
        holdUntil: holdMs > 0 ? now + holdMs : 0,
        ownerSocketId: socket.id,
        startedAt,
      });

      const record = store.upsert(
        publicId,
        { lat: result.value.lat, lng: result.value.lng },
        now,
        holdMs
      );
      socket.data.lastUpdateAt = now;
      saveShare({
        userId,
        publicId,
        lat: record.lat,
        lng: record.lng,
        holdUntil: holdMs > 0 ? now + holdMs : 0,
        startedAt,
        updatedAt: now,
        expiresAt: record.expiresAt,
      });
      io.emit("presence:upsert", record);
      // All of this user's sessions learn the circle's current id (a session
      // that was sharing elsewhere stands down instead of fighting over it).
      emitPresenceMine(userId, publicId);
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
    socket.data.shareStartedAt = 0;
    removePresence(publicId, socket.data.userId);
    // Also clear a circle left behind by an earlier connection of this user.
    const existing = activeShareByUserId.get(socket.data.userId);
    if (existing) removePresence(existing.publicId, socket.data.userId);
  });

  socket.on("disconnect", (reason) => {
    const remaining = (connectionsByIp.get(ip) ?? 1) - 1;
    if (remaining <= 0) connectionsByIp.delete(ip);
    else connectionsByIp.set(ip, remaining);

    untrackUserSocket(socket.data.userId, socket.id);

    // Only a deliberate client disconnect (sign-out) removes the circle right
    // away. Dropped connections (screen locked, app backgrounded, network
    // blip, tab closed) keep it until it expires on its own, so locations no
    // longer vanish the moment a phone goes to sleep.
    if (isDeliberateDisconnect(reason)) {
      removePresence(publicId, socket.data.userId);
      return;
    }

    // The session that was sending this user's circle dropped (refresh, lost
    // signal). If another of their sessions is open, let it take over now
    // instead of leaving the circle frozen until it expires.
    const share = activeShareByUserId.get(socket.data.userId);
    const target = pickHandoverSocket({
      droppedIsOwner: share?.ownerSocketId === socket.id,
      remainingSocketIds: userSocketIds(socket.data.userId),
    });
    const record = share ? store.get(share.publicId, Date.now()) : undefined;
    if (share && record && target) {
      const now = Date.now();
      io.to(target).emit("presence:resume", {
        publicId: share.publicId,
        lat: record.lat,
        lng: record.lng,
        holdRemainingMs: share.holdUntil ? Math.max(0, share.holdUntil - now) : 0,
      });
    }
  });
});

const sweepTimer = setInterval(() => {
  try {
    const expired = store.sweepExpired();
    for (const publicId of expired) {
      io.emit("presence:remove", { publicId });
    }
    forgetExpiredShares(Date.now());
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