import "dotenv/config";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseOrigins(raw: string | undefined): string[] | "*" {
  if (!raw || raw.trim() === "*") return "*";
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export const config = {
  port: intEnv("PORT", 4000),
  corsOrigins: parseOrigins(process.env.CORS_ORIGINS),
  presenceTtlMs: intEnv("PRESENCE_TTL_MS", 60_000),
  sweepIntervalMs: intEnv("SWEEP_INTERVAL_MS", 5_000),
  minUpdateIntervalMs: intEnv("MIN_UPDATE_INTERVAL_MS", 2_000),
  isProduction: process.env.NODE_ENV === "production",
};
