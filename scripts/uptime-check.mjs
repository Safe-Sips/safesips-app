#!/usr/bin/env node
/**
 * Minimal uptime monitor — exits non-zero when /health fails.
 * Schedule via cron, GitHub Actions, or UptimeRobot hitting this script.
 *
 *   node scripts/uptime-check.mjs
 *   API_URL=https://api.safesips.org node scripts/uptime-check.mjs
 */
const API_URL = process.env.API_URL ?? "http://localhost:4000";
const TIMEOUT_MS = Number(process.env.UPTIME_TIMEOUT_MS ?? 8000);

async function main() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${API_URL}/health`, { signal: controller.signal });
    if (!res.ok) {
      console.error(`DOWN: HTTP ${res.status}`);
      process.exit(1);
    }
    const body = await res.json();
    if (body.status !== "ok") {
      console.error(`DOWN: unexpected body ${JSON.stringify(body)}`);
      process.exit(1);
    }
    console.log(`OK: ${API_URL}/health at ${new Date().toISOString()}`);
  } catch (err) {
    console.error(`DOWN: ${err?.message ?? err}`);
    process.exit(1);
  } finally {
    clearTimeout(timer);
  }
}

main();
