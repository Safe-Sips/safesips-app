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

export const config = {
  port: intEnv("PORT", 4000),
  corsOrigins,
  presenceTtlMs: intEnv("PRESENCE_TTL_MS", 60_000),
  sweepIntervalMs: intEnv("SWEEP_INTERVAL_MS", 5_000),
  minUpdateIntervalMs: intEnv("MIN_UPDATE_INTERVAL_MS", 2_000),
  maxConnectionsPerIp: intEnv("MAX_CONNECTIONS_PER_IP", 20),
  isProduction,
};
