#!/usr/bin/env node
/**
 * Production smoke test — CORS, health, and Socket.io round-trip.
 *
 * Usage:
 *   node scripts/smoke-test.mjs
 *   API_URL=https://api.safesips.org WEB_ORIGIN=https://app.safesips.org node scripts/smoke-test.mjs
 */
import { io } from "socket.io-client";

const API_URL = process.env.API_URL ?? "http://localhost:4000";
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

let failed = 0;

function pass(msg) {
  console.log(`✓ ${msg}`);
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  failed += 1;
}

async function checkHealth() {
  const res = await fetch(`${API_URL}/health`);
  if (!res.ok) {
    fail(`GET /health returned ${res.status}`);
    return;
  }
  const body = await res.json();
  if (body.status !== "ok") {
    fail(`/health body: ${JSON.stringify(body)}`);
    return;
  }
  if (body.activeUsers !== undefined && API_URL.startsWith("https://")) {
    fail("Production /health must not expose activeUsers");
    return;
  }
  pass(`GET /health → ${JSON.stringify(body)}`);
}

async function checkCors() {
  const res = await fetch(`${API_URL}/health`, {
    headers: { Origin: WEB_ORIGIN },
  });
  const allowOrigin = res.headers.get("access-control-allow-origin");
  if (!allowOrigin) {
    fail(`No Access-Control-Allow-Origin for ${WEB_ORIGIN}`);
    return;
  }
  if (allowOrigin === "*" && API_URL.startsWith("https://")) {
    fail("Production CORS must not use wildcard *");
    return;
  }
  pass(`CORS allows ${allowOrigin}`);
}

function checkSocket() {
  return new Promise((resolve) => {
    const socket = io(API_URL, {
      transports: ["websocket"],
      extraHeaders: { Origin: WEB_ORIGIN },
      timeout: 10_000,
    });

    const timer = setTimeout(() => {
      fail("Socket connect timeout");
      socket.disconnect();
      resolve();
    }, 12_000);

    socket.on("connect", () => {
      socket.emit("location:update", { lat: 44.43, lng: 26.1 });
    });

    socket.on("presence:self", ({ publicId }) => {
      pass(`Socket connected, publicId=${publicId.slice(0, 8)}…`);
      socket.emit("location:stop");
      clearTimeout(timer);
      socket.disconnect();
      resolve();
    });

    socket.on("connect_error", (err) => {
      fail(`Socket connect_error: ${err.message}`);
      clearTimeout(timer);
      resolve();
    });
  });
}

async function main() {
  console.log(`Smoke test → API ${API_URL}, origin ${WEB_ORIGIN}\n`);
  try {
    await checkHealth();
    await checkCors();
    await checkSocket();
  } catch (err) {
    fail(String(err?.message ?? err));
  }
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
