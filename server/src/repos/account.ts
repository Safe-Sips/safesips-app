import { db } from "../db.js";
import { loginKey } from "../auth/throttle.js";
import { nowMs } from "../util.js";

/**
 * GDPR data subject rights: export (Art. 15/20) and erasure (Art. 17).
 *
 * Every table that holds a user's data is listed here, so a new table must be
 * added in BOTH functions. Live presence is in-memory only and is purged
 * separately (see purgeUserRealtime).
 */

type Row = Record<string, unknown>;

/** Drop internal secrets that are not the user's data and are useless to them. */
function omit(rows: Row[], keys: string[]): Row[] {
  return rows.map((r) => {
    const copy = { ...r };
    for (const k of keys) delete copy[k];
    return copy;
  });
}

const all = (sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as Row[];

export interface AccountExport {
  exportedAt: number;
  note: string;
  profile: Row;
  reports: Row[];
  reportVotes: Row[];
  forumThreads: Row[];
  forumPosts: Row[];
  forumPostVotes: Row[];
  activity: Row[];
  sosContacts: Row[];
  emergencyContacts: Row[];
  emergencyContactFor: Row[];
  friends: Row[];
  alertsReceived: Row[];
  pushDevices: Row[];
  checkinPlans: Row[];
  checkinOccurrences: Row[];
  checkinEscalations: Row[];
  sessions: Row[];
  waitlist: Row[];
}

export function exportAccountData(userId: string): AccountExport | null {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId) as Row | undefined;
  if (!user) return null;
  return {
    exportedAt: nowMs(),
    note:
      "All data SafeSips stores about your account. Your live location is never " +
      "stored: presence circles live only in server memory while you share. " +
      "Password and security-answer hashes are omitted.",
    profile: omit([user], ["password_hash"])[0],
    reports: all(`SELECT * FROM reports WHERE author_id = ?`, userId),
    reportVotes: all(`SELECT * FROM report_votes WHERE user_id = ?`, userId),
    forumThreads: all(`SELECT * FROM forum_threads WHERE author_id = ?`, userId),
    forumPosts: all(`SELECT * FROM forum_posts WHERE author_id = ?`, userId),
    forumPostVotes: all(`SELECT * FROM forum_post_votes WHERE user_id = ?`, userId),
    activity: all(`SELECT * FROM activity_log WHERE user_id = ?`, userId),
    sosContacts: all(`SELECT * FROM sos_contacts WHERE user_id = ?`, userId),
    emergencyContacts: all(
      `SELECT id, invite_label, status, created_at, responded_at FROM emergency_links WHERE owner_id = ?`,
      userId
    ),
    emergencyContactFor: all(
      `SELECT l.id, o.display_name AS person, l.status, l.created_at, l.responded_at
         FROM emergency_links l JOIN users o ON o.id = l.owner_id WHERE l.contact_user_id = ?`,
      userId
    ),
    alertsReceived: all(
      `SELECT a.id, o.display_name AS person, a.plan_label, a.area_lat, a.area_lng, a.created_at, a.acknowledged_at
         FROM checkin_alerts a JOIN users o ON o.id = a.owner_id WHERE a.contact_user_id = ?`,
      userId
    ),
    friends: all(
      `SELECT f.id, f.status, f.created_at, f.responded_at,
              CASE WHEN f.requester_id = ? THEN 'sent' ELSE 'received' END AS direction,
              CASE WHEN f.status = 'accepted' OR f.requester_id <> ? THEN o.display_name ELSE f.invite_label END AS person
         FROM friendships f
         LEFT JOIN users o ON o.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
        WHERE f.requester_id = ? OR f.addressee_id = ?`,
      userId, userId, userId, userId, userId
    ),
    pushDevices: all(`SELECT id, created_at FROM push_subscriptions WHERE user_id = ?`, userId),
    checkinPlans: omit(all(`SELECT * FROM checkin_plans WHERE user_id = ?`, userId), [
      "answer_hash",
    ]),
    checkinOccurrences: all(`SELECT * FROM checkin_occurrences WHERE user_id = ?`, userId),
    checkinEscalations: all(
      `SELECT e.* FROM checkin_escalations e
         JOIN checkin_occurrences o ON o.id = e.occurrence_id
        WHERE o.user_id = ?`,
      userId
    ),
    sessions: omit(all(`SELECT * FROM sessions WHERE user_id = ?`, userId), ["ip_hash"]),
    waitlist: omit(all(`SELECT * FROM waitlist WHERE email_norm = ?`, user.email_norm), [
      "ip_hash",
    ]),
  };
}

export interface DeletedAccount {
  clerkId: string | null;
}

const deleteTx = db.transaction((userId: string, emailNorm: string) => {
  // The waitlist and throttle rows aren't linked by user_id.
  db.prepare(`DELETE FROM waitlist WHERE email_norm = ?`).run(emailNorm);
  // Pending emergency-contact invites addressed to this email (not yet linked).
  db.prepare(`DELETE FROM emergency_links WHERE contact_user_id IS NULL AND invite_email_norm = ?`).run(emailNorm);
  // Friend requests sent to this email (not yet linked to an account).
  db.prepare(`DELETE FROM friendships WHERE addressee_id IS NULL AND invite_email_norm = ?`).run(emailNorm);
  db.prepare(`DELETE FROM auth_attempts WHERE key = ?`).run(loginKey(emailNorm));
  // Everything else references users(id) ON DELETE CASCADE: reports, votes,
  // forum threads/posts (and replies inside the user's threads), activity,
  // SOS contacts, check-in plans/occurrences/escalations, sessions, email
  // verifications.
  db.prepare(`DELETE FROM users WHERE id = ?`).run(userId);
});

/** Permanently erase a user and all their data. Returns null if not found. */
export function deleteAccountData(userId: string): DeletedAccount | null {
  const user = db
    .prepare(`SELECT email_norm, clerk_id FROM users WHERE id = ?`)
    .get(userId) as { email_norm: string; clerk_id: string | null } | undefined;
  if (!user) return null;
  deleteTx(userId, user.email_norm);
  return { clerkId: user.clerk_id };
}
