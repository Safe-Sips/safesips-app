import { db } from "../db.js";
import { nowMs } from "../util.js";

/**
 * Community moderation: reporting content and blocking people.
 *
 *  - Reporting a forum post or a map report hides it for the person who
 *    reported it right away. Once HIDE_AFTER_FLAGS different people report
 *    the same thing, it's hidden for everyone (kept in the database for
 *    review, logged so an operator can follow up).
 *  - Blocking someone hides their forum posts, discussions and map reports
 *    from you, ends any friendship, and keeps their friend requests from
 *    reaching you.
 *
 * App stores require both for apps with user-generated content.
 */

export type FlagTarget = "post" | "report";

/** Different people reporting the same thing before it's hidden for everyone. */
export const HIDE_AFTER_FLAGS = 3;

const insertFlag = db.prepare(
  `INSERT OR IGNORE INTO content_flags (target_type, target_id, reporter_id, reason, created_at)
   VALUES (?, ?, ?, ?, ?)`
);
const countFlags = db.prepare(
  `SELECT COUNT(*) AS c FROM content_flags WHERE target_type = ? AND target_id = ?`
);
const insertBlock = db.prepare(
  `INSERT OR IGNORE INTO user_blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, ?)`
);
const deleteBlock = db.prepare(`DELETE FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`);
const selectBlocks = db.prepare(
  `SELECT b.blocked_id AS user_id, u.display_name, b.created_at
     FROM user_blocks b JOIN users u ON u.id = b.blocked_id
    WHERE b.blocker_id = ? ORDER BY b.created_at DESC`
);
const blockBetween = db.prepare(
  `SELECT 1 AS x FROM user_blocks
    WHERE (blocker_id = @a AND blocked_id = @b) OR (blocker_id = @b AND blocked_id = @a)`
);
const dropFriendships = db.prepare(
  `DELETE FROM friendships
    WHERE (requester_id = @a AND addressee_id = @b) OR (requester_id = @b AND addressee_id = @a)`
);
const declineFriendRequests = db.prepare(
  `INSERT OR REPLACE INTO friend_declines (decliner_id, requester_id, created_at) VALUES (?, ?, ?)`
);

/**
 * SQL to keep content by blocked authors (and content the viewer reported)
 * out of a query. `authorCol` / `idCol` are trusted column references;
 * `@viewer` must be bound.
 */
export function hiddenForViewerSql(authorCol: string, target: FlagTarget, idCol: string): string {
  return `
    AND ${authorCol} NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = @viewer)
    AND NOT EXISTS (SELECT 1 FROM content_flags f
                     WHERE f.target_type = '${target}' AND f.target_id = ${idCol}
                       AND f.reporter_id = @viewer)`;
}

/**
 * Record a report of a post or map report. Returns how many different people
 * have reported it, so the caller can hide it for everyone at the threshold.
 */
export function flagContent(
  reporterId: string,
  target: FlagTarget,
  targetId: string,
  reason: string | null
): number {
  insertFlag.run(target, targetId, reporterId, reason, nowMs());
  return (countFlags.get(target, targetId) as { c: number }).c;
}

/** Block someone: hide their content from me and end any friendship. */
export const blockUser = db.transaction((blockerId: string, blockedId: string): void => {
  insertBlock.run(blockerId, blockedId, nowMs());
  dropFriendships.run({ a: blockerId, b: blockedId });
  // Their friend requests (and any they already sent) stay quiet for me.
  declineFriendRequests.run(blockerId, blockedId, nowMs());
}) as (blockerId: string, blockedId: string) => void;

export function unblockUser(blockerId: string, blockedId: string): boolean {
  return deleteBlock.run(blockerId, blockedId).changes > 0;
}

export function listBlocks(userId: string): Array<{ userId: string; displayName: string; blockedAt: number }> {
  return (selectBlocks.all(userId) as Array<{ user_id: string; display_name: string; created_at: number }>).map(
    (r) => ({ userId: r.user_id, displayName: r.display_name, blockedAt: r.created_at })
  );
}

/** Has either of these two people blocked the other? */
export function eitherBlocked(a: string, b: string): boolean {
  return blockBetween.get({ a, b }) !== undefined;
}

/* -------------------------------- Rate limits -------------------------------- */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const recentReports = db.prepare(`SELECT COUNT(*) AS c FROM reports WHERE author_id = ? AND created_at > ?`);
const recentThreads = db.prepare(`SELECT COUNT(*) AS c FROM forum_threads WHERE author_id = ? AND created_at > ?`);
const recentPosts = db.prepare(`SELECT COUNT(*) AS c FROM forum_posts WHERE author_id = ? AND created_at > ?`);

/** Per-user posting limits: generous for people, too tight for flooding. */
const LIMITS = {
  report: { stmt: recentReports, perHour: 10, perDay: 30, noun: "reports" },
  thread: { stmt: recentThreads, perHour: 5, perDay: 20, noun: "discussions" },
  post: { stmt: recentPosts, perHour: 30, perDay: 200, noun: "replies" },
} as const;

/** null if the user may post another one, else a message saying to wait. */
export function postingLimitError(kind: keyof typeof LIMITS, userId: string): string | null {
  const l = LIMITS[kind];
  const now = nowMs();
  const count = (since: number) => (l.stmt.get(userId, since) as { c: number }).c;
  if (count(now - HOUR) >= l.perHour) {
    return `You've posted a lot of ${l.noun} in the last hour. Please wait a bit and try again.`;
  }
  if (count(now - DAY) >= l.perDay) {
    return `You've reached today's limit for ${l.noun}. Try again tomorrow.`;
  }
  return null;
}
