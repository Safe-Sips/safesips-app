import { config } from "../config.js";
import { db } from "../db.js";
import { genId, nowMs, sha256 } from "../util.js";

const insertAttempt = db.prepare(
  `INSERT INTO auth_attempts (id, key, created_at) VALUES (?, ?, ?)`
);
const countRecent = db.prepare(
  `SELECT COUNT(*) AS c FROM auth_attempts WHERE key = ? AND created_at > ?`
);
const deleteOld = db.prepare(`DELETE FROM auth_attempts WHERE created_at <= ?`);

export function loginKey(emailNorm: string): string {
  return `login:${emailNorm}`;
}

export function ipKey(ip: string): string {
  return `ip:${sha256(ip)}`;
}

/** Record one failed auth attempt for a key (email or IP). */
export function recordFailure(key: string): void {
  insertAttempt.run(genId(), key, nowMs());
}

/** True when a key has too many recent failures within the window. */
export function isThrottled(key: string): boolean {
  const since = nowMs() - config.authFailWindowMs;
  const row = countRecent.get(key, since) as { c: number };
  return row.c >= config.authMaxFails;
}

/** Purge attempts older than the window (called from the sweep timer). */
export function purgeOldAttempts(): void {
  deleteOld.run(nowMs() - config.authFailWindowMs);
}
