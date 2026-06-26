#!/usr/bin/env node
/**
 * Production smoke test — CORS, health, and authenticated Socket.io round-trip.
 *
 * The socket handshake now requires a JWT, so this test:
 *   1. confirms an anonymous (no-token) connection is REJECTED, and
 *   2. if a test token is available (ALLOW_TEST_TOKEN=1 → GET /api/auth/test-token),
 *      runs an authenticated presence round-trip and checks it leaks no identity.
 *
 * Usage:
 *   ALLOW_TEST_TOKEN=1 node scripts/smoke-test.mjs
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

/** An unauthenticated socket must be rejected at the handshake. */
function checkSocketRejectsAnon() {
  return new Promise((resolve) => {
    const socket = io(API_URL, {
      transports: ["websocket"],
      extraHeaders: { Origin: WEB_ORIGIN },
      reconnection: false,
      timeout: 10_000,
    });
    const timer = setTimeout(() => {
      fail("Anonymous socket neither connected nor errored (timeout)");
      socket.disconnect();
      resolve();
    }, 12_000);

    socket.on("connect", () => {
      fail("Anonymous socket connected — handshake auth is NOT enforced!");
      clearTimeout(timer);
      socket.disconnect();
      resolve();
    });
    socket.on("connect_error", (err) => {
      pass(`Anonymous socket correctly rejected (${err.message})`);
      clearTimeout(timer);
      resolve();
    });
  });
}

async function fetchTestToken() {
  try {
    const res = await fetch(`${API_URL}/api/auth/test-token`);
    if (!res.ok) return null;
    const body = await res.json();
    return body.token ?? null;
  } catch {
    return null;
  }
}

/** Authenticated presence round-trip; verifies no identity leaks on the wire. */
function checkSocketAuthed(token) {
  return new Promise((resolve) => {
    const socket = io(API_URL, {
      transports: ["websocket"],
      auth: { token },
      extraHeaders: { Origin: WEB_ORIGIN },
      reconnection: false,
      timeout: 10_000,
    });
    const timer = setTimeout(() => {
      fail("Authenticated socket connect timeout");
      socket.disconnect();
      resolve();
    }, 12_000);

    socket.on("presence:self", ({ publicId }) => {
      pass(`Authenticated socket connected, publicId=${publicId.slice(0, 8)}…`);
      socket.emit("location:update", { lat: 44.43, lng: 26.1 });
    });
    socket.on("presence:upsert", (record) => {
      if ("userId" in record) {
        fail("presence:upsert leaks userId");
      } else {
        pass("presence:upsert carries no account identity");
      }
      socket.emit("location:stop");
      clearTimeout(timer);
      socket.disconnect();
      resolve();
    });
    socket.on("connect_error", (err) => {
      fail(`Authenticated socket connect_error: ${err.message}`);
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
    await checkSocketRejectsAnon();
    const token = await fetchTestToken();
    if (token) {
      await checkSocketAuthed(token);
    } else {
      console.log(
        "• Skipping authenticated round-trip (no test token; set ALLOW_TEST_TOKEN=1 to enable)."
      );
    }
  } catch (err) {
    fail(String(err?.message ?? err));
  }
  console.log(failed ? `\n${failed} check(s) failed.` : "\nAll checks passed.");
  process.exit(failed ? 1 : 0);
}

main();
