import { db } from "./db.js";

/**
 * Location shares survive a server restart (a deploy, a crash). Only the
 * masked circle centre is stored — the same point every other user already
 * sees — never the exact position, which doesn't leave the device. A row is
 * deleted when the share stops or runs out.
 */

export interface StoredShare {
  userId: string;
  publicId: string;
  lat: number;
  lng: number;
  /** 0 in live mode, else when a "share for" window ends (epoch ms). */
  holdUntil: number;
  startedAt: number;
  updatedAt: number;
  expiresAt: number;
}

const upsert = db.prepare(
  `INSERT INTO presence_shares (user_id, public_id, lat, lng, hold_until, started_at, updated_at, expires_at)
   VALUES (@userId, @publicId, @lat, @lng, @holdUntil, @startedAt, @updatedAt, @expiresAt)
   ON CONFLICT(user_id) DO UPDATE SET
     public_id = excluded.public_id, lat = excluded.lat, lng = excluded.lng,
     hold_until = excluded.hold_until, started_at = excluded.started_at,
     updated_at = excluded.updated_at, expires_at = excluded.expires_at`
);
const deleteByPublicId = db.prepare(`DELETE FROM presence_shares WHERE public_id = ?`);
const deleteExpired = db.prepare(`DELETE FROM presence_shares WHERE expires_at <= ?`);
const selectLive = db.prepare(
  `SELECT user_id, public_id, lat, lng, hold_until, started_at, updated_at, expires_at
     FROM presence_shares WHERE expires_at > ?`
);

/** Never throws: persistence is best effort and must not break sharing. */
function safely(what: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[presence] couldn't ${what}:`, err instanceof Error ? err.message : err);
  }
}

export function saveShare(share: StoredShare): void {
  safely("save a share", () => upsert.run(share));
}

export function forgetShare(publicId: string): void {
  safely("forget a share", () => deleteByPublicId.run(publicId));
}

export function forgetExpiredShares(now: number): void {
  safely("prune shares", () => deleteExpired.run(now));
}

/** Shares still running, to restore after a restart. */
export function loadShares(now: number): StoredShare[] {
  try {
    return (selectLive.all(now) as Array<{
      user_id: string;
      public_id: string;
      lat: number;
      lng: number;
      hold_until: number;
      started_at: number;
      updated_at: number;
      expires_at: number;
    }>).map((r) => ({
      userId: r.user_id,
      publicId: r.public_id,
      lat: r.lat,
      lng: r.lng,
      holdUntil: r.hold_until,
      startedAt: r.started_at,
      updatedAt: r.updated_at,
      expiresAt: r.expires_at,
    }));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[presence] couldn't restore shares:", err instanceof Error ? err.message : err);
    return [];
  }
}
