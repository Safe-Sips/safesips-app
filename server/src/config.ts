import { randomBytes } from "node:crypto";
import dotenv from "dotenv";

dotenv.config();
if (process.env.NODE_ENV === "production") {
  dotenv.config({ path: ".env.production", override: true });
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function strEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim() !== "" ? raw.trim() : fallback;
}

function boolEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Parse comma-separated CORS origins. Never defaults to wildcard. */
function parseOrigins(raw: string | undefined): string[] {
  if (!raw || raw.trim() === "") return [];
  if (raw.trim() === "*") return ["*"];
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const isProduction = process.env.NODE_ENV === "production";
const rawOrigins = parseOrigins(process.env.CORS_ORIGINS);

if (isProduction) {
  if (rawOrigins.length === 0 || rawOrigins.includes("*")) {
    throw new Error(
      "CORS_ORIGINS must list explicit HTTPS origins in production. Wildcards are not allowed."
    );
  }
}

/** Resolved origins used by Express and Socket.io. */
const corsOrigins =
  rawOrigins.length > 0
    ? rawOrigins
    : ["http://localhost:5173", "http://127.0.0.1:5173"];

/**
 * JWT signing secret. Required in production — the server refuses to boot
 * without it (mirrors the CORS_ORIGINS hard-fail). In development a random
 * ephemeral secret is generated so local runs work, with a loud warning that
 * tokens won't survive a restart.
 */
function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim();
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (isProduction) {
    throw new Error(
      "JWT_SECRET must be set (>=16 chars) in production. Generate one with: openssl rand -hex 32"
    );
  }
  const ephemeral = randomBytes(32).toString("hex");
  // eslint-disable-next-line no-console
  console.warn(
    "[config] JWT_SECRET not set — using a random ephemeral secret for development. " +
      "All sessions become invalid on restart. Set JWT_SECRET in .env to persist logins."
  );
  return ephemeral;
}

export const config = {
  port: intEnv("PORT", 4000),
  corsOrigins,
  isProduction,

  // Real-time presence (existing behavior).
  presenceTtlMs: intEnv("PRESENCE_TTL_MS", 60_000),
  sweepIntervalMs: intEnv("SWEEP_INTERVAL_MS", 5_000),
  minUpdateIntervalMs: intEnv("MIN_UPDATE_INTERVAL_MS", 2_000),
  maxConnectionsPerIp: intEnv("MAX_CONNECTIONS_PER_IP", 20),

  // Persistence.
  databasePath: strEnv("DATABASE_PATH", "./data/safesips.db"),

  // Auth.
  jwtSecret: resolveJwtSecret(),
  jwtTtlDays: intEnv("JWT_TTL_DAYS", 7),
  bcryptRounds: intEnv("BCRYPT_ROUNDS", 11),
  /** Sliding-window throttle for failed auth attempts (per email + per IP). */
  authMaxFails: intEnv("AUTH_MAX_FAILS", 6),
  authFailWindowMs: intEnv("AUTH_FAIL_WINDOW_MS", 15 * 60_000),
  /** Hours an email-verification / reset token stays valid. */
  emailTokenTtlHours: intEnv("EMAIL_TOKEN_TTL_HOURS", 24),

  // Anti-bot: pluggable Cloudflare Turnstile. When unset, the built-in
  // throttle + email verification are the only gates.
  turnstileSecret: process.env.TURNSTILE_SECRET?.trim() || null,

  // Where the web app is served (for verification links in emails).
  webAppUrl: strEnv("WEB_APP_URL", "http://localhost:5173"),

  // SMTP transport for real verification emails. When SMTP_HOST is unset, the
  // server falls back to logging the link (dev) instead of sending.
  smtp: process.env.SMTP_HOST?.trim()
    ? {
        host: process.env.SMTP_HOST.trim(),
        port: intEnv("SMTP_PORT", 587),
        secure: boolEnv("SMTP_SECURE"),
        user: process.env.SMTP_USER?.trim() || undefined,
        pass: process.env.SMTP_PASS || undefined,
      }
    : null,
  emailFrom: strEnv("EMAIL_FROM", "SafeSips <no-reply@safesips.app>"),

  // Check-in scheduler sweep cadence.
  checkinSweepIntervalMs: intEnv("CHECKIN_SWEEP_INTERVAL_MS", 15_000),

  // Allows scripts/smoke-test.mjs to mint a throwaway token via /api/test-token.
  // NEVER enable in production.
  allowTestToken: boolEnv("ALLOW_TEST_TOKEN") && !isProduction,
};
