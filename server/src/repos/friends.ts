import type {
  UserSearchResultDTO,
  FriendDTO,
  FriendProfileDTO,
  FriendRequestDTO,
  FriendsOverviewDTO,
  OutgoingFriendRequestDTO,
} from "@safesips/shared";
import { db } from "../db.js";
import { foldName, genId, normalizeEmail, nowMs } from "../util.js";
import { computeCounts } from "./stats.js";
import { eitherBlocked } from "./moderation.js";

/**
 * Friends: SafeSips users who accepted each other. Added by name search or
 * account email; the other person must accept. Friends can
 * see each other's profile and ask each other to be an emergency contact.
 *
 * A request by email is always stored against the email (addressee_id NULL),
 * whether or not the address has an account, and matched to an account when
 * someone with that email looks or accepts. So the sender sees the same thing
 * either way and can't use this to find out who uses SafeSips.
 *
 * Declining is private and sticks: the requester isn't told (their request
 * keeps showing as waiting), and requests they send later never reach the
 * person who declined — no list entry, no notification — until that person
 * adds them. Removing a friend works the same way. This keeps someone from
 * pestering a person with request after request.
 */

/** Max new friend requests one user can send per 24 h (anti-spam). */
export const MAX_FRIEND_REQUESTS_PER_DAY = 30;

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string | null;
  invite_email_norm: string | null;
  status: "pending" | "accepted" | "declined";
  created_at: number;
  responded_at: number | null;
}

const userByEmail = db.prepare(`SELECT id FROM users WHERE email_norm = ?`);
const userRow = db.prepare(
  `SELECT id, display_name, email_norm, image_url, created_at FROM users WHERE id = ?`
);
const countRecent = db.prepare(
  `SELECT COUNT(*) AS c FROM friendships WHERE requester_id = ? AND created_at > ?`
);
/** Rows between two users, whether addressed by account or by email. */
const rowsBetween = db.prepare(
  `SELECT * FROM friendships
    WHERE (requester_id = @a AND (addressee_id = @b OR (addressee_id IS NULL AND invite_email_norm = @bEmail)))
       OR (requester_id = @b AND (addressee_id = @a OR (addressee_id IS NULL AND invite_email_norm = @aEmail)))`
);
const emailInvite = db.prepare(
  `SELECT id FROM friendships WHERE requester_id = ? AND addressee_id IS NULL AND invite_email_norm = ?`
);
const insertRow = db.prepare(
  `INSERT INTO friendships (id, requester_id, addressee_id, invite_email_norm, invite_label, status, created_at)
   VALUES (@id, @requester_id, @addressee_id, @invite_email_norm, @invite_label, 'pending', @created_at)`
);
const acceptRow = db.prepare(
  `UPDATE friendships SET status = 'accepted', addressee_id = ?, invite_email_norm = NULL, responded_at = ?
    WHERE id = ?`
);
const declineRow = db.prepare(
  `UPDATE friendships SET status = 'declined', responded_at = ? WHERE id = ?`
);
const deleteRow = db.prepare(`DELETE FROM friendships WHERE id = ?`);
const rowById = db.prepare(`SELECT * FROM friendships WHERE id = ?`);
const friendsOf = db.prepare(
  `SELECT f.id, f.responded_at, f.created_at, u.id AS user_id, u.display_name, u.image_url
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = @me THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted' AND (f.requester_id = @me OR f.addressee_id = @me)
    ORDER BY u.display_name COLLATE NOCASE`
);
const incomingFor = db.prepare(
  `SELECT f.id, f.requester_id, f.created_at, u.display_name AS from_name
     FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.status = 'pending' AND f.requester_id <> @me
      AND (f.addressee_id = @me OR (f.addressee_id IS NULL AND f.invite_email_norm = @email))
      AND NOT EXISTS (SELECT 1 FROM friend_declines d
                       WHERE d.decliner_id = @me AND d.requester_id = f.requester_id)
    ORDER BY f.created_at DESC`
);
// Declined requests still show as waiting to the person who sent them.
const outgoingFor = db.prepare(
  `SELECT id, invite_label, created_at FROM friendships
    WHERE status IN ('pending', 'declined') AND requester_id = ? ORDER BY created_at DESC`
);
const discoverableOf = db.prepare(`SELECT discoverable FROM users WHERE id = ?`);
const setDiscoverableStmt = db.prepare(
  `UPDATE users SET discoverable = ?, search_notice_seen = 1, updated_at = ? WHERE id = ?`
);
const setNoticeSeenStmt = db.prepare(`UPDATE users SET search_notice_seen = 1 WHERE id = ?`);
const insertDecline = db.prepare(
  `INSERT OR REPLACE INTO friend_declines (decliner_id, requester_id, created_at) VALUES (?, ?, ?)`
);
const clearDeclineStmt = db.prepare(
  `DELETE FROM friend_declines WHERE decliner_id = ? AND requester_id = ?`
);
const hasDecline = db.prepare(
  `SELECT 1 AS x FROM friend_declines WHERE decliner_id = ? AND requester_id = ?`
);
/**
 * Candidates for a name search, best kinds of match first so the cap never
 * cuts a real match: name starts with it, a word starts with it, contains
 * it, then names sharing its first two letters (for typo matching).
 * name_search is the folded name (lower-case, no accents).
 *
 * Names Clerk generated from the email (no name set on the account) are left
 * out: listing them would reveal most of the address and let people check
 * whether an email uses SafeSips.
 */
const searchCandidates = db.prepare(
  `SELECT id, display_name, image_url FROM users
    WHERE discoverable = 1 AND status = 'active' AND id <> @me
      AND id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = @me)
      AND id NOT IN (SELECT blocker_id FROM user_blocks WHERE blocked_id = @me)
      AND instr(display_name, '@') = 0
      AND lower(trim(display_name)) <> lower(substr(email, 1, instr(email, '@') - 1))
      AND (name_search LIKE @contains ESCAPE '\\' OR name_search LIKE @head ESCAPE '\\')
    ORDER BY CASE
               WHEN name_search LIKE @prefix ESCAPE '\\' THEN 0
               WHEN name_search LIKE @wordPrefix ESCAPE '\\' THEN 1
               WHEN name_search LIKE @contains ESCAPE '\\' THEN 2
               ELSE 3
             END,
             name_search
    LIMIT 300`
);
const myContactLink = db.prepare(
  `SELECT status FROM emergency_links WHERE owner_id = ? AND contact_user_id = ?`
);
/** My emergency-contact requests, by the account they went to (by id or by email). */
const myContactLinks = db.prepare(
  `SELECT COALESCE(l.contact_user_id, u.id) AS user_id, l.status
     FROM emergency_links l
     LEFT JOIN users u ON l.contact_user_id IS NULL AND u.email_norm = l.invite_email_norm
    WHERE l.owner_id = ?`
);
/** People who have me as an accepted emergency contact. */
const contactFor = db.prepare(
  `SELECT owner_id FROM emergency_links WHERE contact_user_id = ? AND status = 'accepted'`
);

const emailOf = (userId: string): string =>
  (userRow.get(userId) as { email_norm: string } | undefined)?.email_norm ?? "";

function between(a: string, b: string): FriendshipRow[] {
  return rowsBetween.all({ a, b, aEmail: emailOf(a), bEmail: emailOf(b) }) as FriendshipRow[];
}

/** Is this row addressed to me (by account or by my email)? `myEmail` saves a lookup. */
function addressedTo(row: FriendshipRow, me: string, myEmail = emailOf(me)): boolean {
  if (row.requester_id === me) return false;
  return row.addressee_id === me || (row.addressee_id === null && row.invite_email_norm === myEmail);
}

/** Did `decliner` decline (or unfriend) `requester`, so their requests stay quiet? */
function declined(decliner: string, requester: string): boolean {
  return hasDecline.get(decliner, requester) !== undefined;
}

/**
 * Accept `row` as `me`. It becomes the one friendship between us; any other
 * request either of us sent the other (by name or by email) is dropped.
 */
function acceptAs(me: string, row: FriendshipRow): void {
  for (const other of between(me, row.requester_id)) {
    if (other.id !== row.id) deleteRow.run(other.id);
  }
  acceptRow.run(me, nowMs(), row.id);
  clearDeclineStmt.run(me, row.requester_id);
  clearDeclineStmt.run(row.requester_id, me);
}

export type FriendRequestResult =
  | { ok: true; message: string; notify: { userId: string; accepted: boolean } | null }
  | { ok: false; error: string };

/**
 * The shared part of "I'm asking this account to be friends": accept their
 * request if they already asked me, else add mine (once). I'm reaching out,
 * so any decline I'd recorded against them is lifted.
 */
function askUser(me: string, targetId: string, label: string, sent: string): FriendRequestResult {
  clearDeclineStmt.run(me, targetId);
  const rows = between(me, targetId);
  if (rows.some((r) => r.status === "accepted")) {
    return { ok: true, message: "You're already friends.", notify: null };
  }
  // A request of theirs I declined earlier counts: asking back means yes.
  const theirs = rows.find((r) => r.status !== "accepted" && addressedTo(r, me));
  if (theirs) {
    acceptAs(me, theirs);
    return { ok: true, message: "You're now friends.", notify: { userId: targetId, accepted: true } };
  }
  if (rows.some((r) => r.requester_id === me && r.addressee_id === targetId)) {
    return { ok: true, message: sent, notify: null };
  }
  insertRow.run({
    id: genId(),
    requester_id: me,
    addressee_id: targetId,
    invite_email_norm: null,
    invite_label: label,
    created_at: nowMs(),
  });
  // Someone who declined me never hears about it.
  return { ok: true, message: sent, notify: declined(targetId, me) ? null : { userId: targetId, accepted: false } };
}

function overLimit(me: string): boolean {
  const since = nowMs() - 24 * 60 * 60 * 1000;
  return (countRecent.get(me, since) as { c: number }).c >= MAX_FRIEND_REQUESTS_PER_DAY;
}
const LIMIT_ERROR = "You've sent a lot of friend requests today. Try again tomorrow.";

/** Send a friend request by account email. */
export const requestFriend = db.transaction((me: string, identifier: string): FriendRequestResult => {
  const raw = identifier.trim();
  if (!raw) return { ok: false, error: "Enter their email." };
  if (overLimit(me)) return { ok: false, error: LIMIT_ERROR };

  if (!raw.includes("@")) {
    return { ok: false, error: "Enter their email address, or search for them by name." };
  }
  const emailNorm = normalizeEmail(raw);
  if (emailNorm === emailOf(me)) return { ok: false, error: "That's your own email." };
  const sent = `Request sent to ${emailNorm}. If they use SafeSips, they'll see it there.`;
  const targetId = (userByEmail.get(emailNorm) as { id: string } | undefined)?.id;
  if (targetId) {
    clearDeclineStmt.run(me, targetId);
    const rows = between(me, targetId);
    // Same reply in every case, so the email's owner stays private.
    if (rows.some((r) => r.status === "accepted")) return { ok: true, message: sent, notify: null };
    const theirs = rows.find((r) => r.status !== "accepted" && addressedTo(r, me));
    if (theirs) {
      acceptAs(me, theirs);
      return { ok: true, message: sent, notify: { userId: targetId, accepted: true } };
    }
  }
  if (emailInvite.get(me, emailNorm)) return { ok: true, message: sent, notify: null };
  insertRow.run({
    id: genId(),
    requester_id: me,
    addressee_id: null,
    invite_email_norm: emailNorm,
    invite_label: emailNorm,
    created_at: nowMs(),
  });
  const notify = targetId && !declined(targetId, me) ? { userId: targetId, accepted: false } : null;
  return { ok: true, message: sent, notify };
}) as (me: string, identifier: string) => FriendRequestResult;

/**
 * Send a friend request to someone picked from search. Only for people who
 * allow being found by name — or who are already connected to me (asked me,
 * or are my friend) — so ids can't reach people who opted out.
 */
export const requestFriendByUserId = db.transaction((me: string, targetId: string): FriendRequestResult => {
  if (targetId === me) return { ok: false, error: "That's you." };
  const target = userRow.get(targetId) as { id: string; display_name: string } | undefined;
  const connected = target
    ? between(me, targetId).some((r) => r.status === "accepted" || addressedTo(r, me))
    : false;
  if (!target || (!isDiscoverable(targetId) && !connected) || eitherBlocked(me, targetId)) {
    return { ok: false, error: "That person can't be found." };
  }
  if (overLimit(me)) return { ok: false, error: LIMIT_ERROR };
  return askUser(me, targetId, target.display_name, "Friend request sent.");
}) as (me: string, targetId: string) => FriendRequestResult;

export function getFriendsOverview(me: string): FriendsOverviewDTO {
  const myLinks = new Map<string, "pending" | "accepted">();
  for (const l of myContactLinks.all(me) as Array<{ user_id: string | null; status: "pending" | "accepted" }>) {
    // An accepted link wins over a leftover pending one.
    if (l.user_id && myLinks.get(l.user_id) !== "accepted") myLinks.set(l.user_id, l.status);
  }
  const theirContact = new Set((contactFor.all(me) as Array<{ owner_id: string }>).map((r) => r.owner_id));
  const friends = (friendsOf.all({ me }) as Array<{
    id: string;
    responded_at: number | null;
    created_at: number;
    user_id: string;
    display_name: string;
    image_url: string | null;
  }>).map<FriendDTO>((r) => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    imageUrl: r.image_url,
    since: r.responded_at ?? r.created_at,
    emergencyContact: myLinks.get(r.user_id) ?? "none",
    isTheirContact: theirContact.has(r.user_id),
  }));
  // One entry per person, even if they asked by both name and email.
  const seen = new Set<string>();
  const incoming = (incomingFor.all({ me, email: emailOf(me) }) as Array<{
    id: string;
    requester_id: string;
    created_at: number;
    from_name: string;
  }>)
    .filter((r) => (seen.has(r.requester_id) ? false : (seen.add(r.requester_id), true)))
    .map<FriendRequestDTO>((r) => ({ id: r.id, fromDisplayName: r.from_name, createdAt: r.created_at }));
  const outgoing = (outgoingFor.all(me) as Array<{ id: string; invite_label: string; created_at: number }>).map<OutgoingFriendRequestDTO>(
    (r) => ({ id: r.id, label: r.invite_label, createdAt: r.created_at })
  );
  return {
    discoverable: isDiscoverable(me),
    friends,
    incoming,
    outgoing,
  };
}

/** Accept a request addressed to me. Returns the requester's id, or null. */
export const acceptFriend = db.transaction((me: string, friendshipId: string): string | null => {
  const row = rowById.get(friendshipId) as FriendshipRow | undefined;
  if (!row || row.status !== "pending" || !addressedTo(row, me)) return null;
  acceptAs(me, row);
  return row.requester_id;
}) as (me: string, friendshipId: string) => string | null;

/**
 * Cancel a request I sent, decline one sent to me, or unfriend. Returns who
 * to refresh (`other`; null when they shouldn't be told), or null if the row
 * isn't mine to touch.
 *
 * Declining marks every request that person sent me as declined (so a
 * name + email pair goes in one tap) and records the decline; unfriending
 * records it too. Either way their later requests stay quiet.
 */
export const removeFriendship = db.transaction(
  (me: string, friendshipId: string): { other: string | null; unfriended?: string } | null => {
    const row = rowById.get(friendshipId) as FriendshipRow | undefined;
    if (!row) return null;
    const sentByMe = row.requester_id === me;
    const myEmail = emailOf(me);

    if (sentByMe && row.status !== "accepted") {
      deleteRow.run(row.id);
      const other =
        row.addressee_id ??
        (row.invite_email_norm
          ? ((userByEmail.get(row.invite_email_norm) as { id: string } | undefined)?.id ?? null)
          : null);
      return { other };
    }
    if (!sentByMe && !addressedTo(row, me, myEmail)) return null;
    const other = sentByMe ? row.addressee_id : row.requester_id;
    if (!other) return null;

    if (row.status === "accepted") {
      deleteRow.run(row.id);
      insertDecline.run(me, other, nowMs());
      return { other, unfriended: other };
    }
    // Declining: quietly, and all of their requests at once.
    const now = nowMs();
    for (const r of between(me, other)) {
      if (r.requester_id === other && r.status === "pending" && addressedTo(r, me, myEmail)) {
        declineRow.run(now, r.id);
      }
    }
    insertDecline.run(me, other, now);
    return { other: null };
  }
) as (me: string, friendshipId: string) => { other: string | null; unfriended?: string } | null;

/** The accepted friendship between two users, if any. */
function acceptedFriendship(me: string, other: string): FriendshipRow | undefined {
  if (me === other) return undefined;
  return between(me, other).find((r) => r.status === "accepted");
}

export function areFriends(me: string, other: string): boolean {
  return acceptedFriendship(me, other) !== undefined;
}

const friendClerkIdsOf = db.prepare(
  `SELECT u.clerk_id FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = @me THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted' AND (f.requester_id = @me OR f.addressee_id = @me) AND u.clerk_id IS NOT NULL
    ORDER BY u.clerk_id`
);

/** My friends' Clerk ids: what friendBackup.ts saves. */
export function friendClerkIds(me: string): string[] {
  return (friendClerkIdsOf.all({ me }) as Array<{ clerk_id: string }>).map((r) => r.clerk_id);
}

/**
 * Make two users friends again from a backup: replaces any requests between
 * them with one accepted friendship. No-op if they already are.
 */
export const restoreFriendship = db.transaction((a: string, b: string): boolean => {
  if (a === b || areFriends(a, b)) return false;
  for (const r of between(a, b)) deleteRow.run(r.id);
  const now = nowMs();
  insertRow.run({ id: genId(), requester_id: a, addressee_id: b, invite_email_norm: null, invite_label: "", created_at: now });
  const row = between(a, b).find((r) => r.requester_id === a && r.addressee_id === b)!;
  acceptRow.run(b, now, row.id);
  return true;
}) as (a: string, b: string) => boolean;

/** A friend's profile; null unless we're friends. */
export function getFriendProfile(me: string, friendId: string): FriendProfileDTO | null {
  const friendship = acceptedFriendship(me, friendId);
  if (!friendship) return null;
  const user = userRow.get(friendId) as
    | { id: string; display_name: string; image_url: string | null; created_at: number }
    | undefined;
  if (!user) return null;
  const counts = computeCounts(friendId);
  const link = myContactLink.get(me, friendId) as { status: "pending" | "accepted" } | undefined;
  return {
    userId: user.id,
    friendshipId: friendship.id,
    displayName: user.display_name,
    imageUrl: user.image_url,
    memberSince: user.created_at,
    friendsSince: friendship.responded_at ?? friendship.created_at,
    counts: {
      reports: counts.reports,
      threads: counts.threads,
      posts: counts.posts,
      upvotesReceived: counts.upvotesReceived,
    },
    emergencyContact: link?.status ?? "none",
  };
}

/* ------------------------------ Search by name ------------------------------ */

export function isDiscoverable(userId: string): boolean {
  return (discoverableOf.get(userId) as { discoverable: number } | undefined)?.discoverable !== 0;
}

/** Turn "find me by name" on/off (this also counts as having seen the notice). */
export function setDiscoverable(userId: string, on: boolean): void {
  setDiscoverableStmt.run(on ? 1 : 0, nowMs(), userId);
}

/** "Got it" on the one-time name-search notice. */
export function markSearchNoticeSeen(userId: string): void {
  setNoticeSeenStmt.run(userId);
}

/**
 * Edit distance where swapping two neighbouring letters counts as one typo
 * ("smoek" → "smoke"), capped: anything above `max` returns max + 1.
 */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let before: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, before[j - 2] + 1);
      cur.push(v);
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
    before = prev;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * How well a name matches the query (lower = better), or null if not at all:
 * whole name starts with it, a word starts with it, contains it, then a word
 * (or the start of the name) within one or two typos of it.
 */
export function matchRank(name: string, query: string): number | null {
  const n = foldName(name);
  const q = foldName(query);
  if (!q) return null;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  const words = n.split(" ");
  if (words.some((w) => w.startsWith(q))) return 2;
  if (n.includes(q)) return 3;
  const allowed = q.length >= 6 ? 2 : 1;
  let best = allowed + 1;
  for (const w of [...words, n]) {
    best = Math.min(best, editDistance(w.slice(0, q.length + 1), q, allowed), editDistance(w, q, allowed));
  }
  return best <= allowed ? 3 + best : null;
}

export const SEARCH_MIN_CHARS = 3;
export const SEARCH_MAX_RESULTS = 10;

const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * Find people by display name. Only discoverable, active users other than me
 * whose name isn't made up from their email; name and picture only.
 * Rate-limited by the route.
 */
export function searchUsers(me: string, rawQuery: string): UserSearchResultDTO[] {
  const q = foldName(rawQuery.slice(0, 60));
  if (q.length < SEARCH_MIN_CHARS) return [];
  const esc = likeEscape(q);
  const rows = searchCandidates.all({
    me,
    prefix: `${esc}%`,
    wordPrefix: `% ${esc}%`,
    contains: `%${esc}%`,
    head: `%${likeEscape(q.slice(0, 2))}%`,
  }) as Array<{ id: string; display_name: string; image_url: string | null }>;

  const myEmail = emailOf(me);
  return rows
    .map((r) => ({ r, rank: matchRank(r.display_name, q) }))
    .filter((x): x is { r: (typeof rows)[number]; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.r.display_name.localeCompare(b.r.display_name))
    .slice(0, SEARCH_MAX_RESULTS)
    .map(({ r }) => {
      const rel = rowsBetween.all({ a: me, b: r.id, aEmail: myEmail, bEmail: emailOf(r.id) }) as FriendshipRow[];
      const relation: UserSearchResultDTO["relation"] = rel.some((x) => x.status === "accepted")
        ? "friend"
        : rel.some((x) => x.status === "pending" && addressedTo(x, me, myEmail)) && !declined(me, r.id)
          ? "received"
          : rel.some((x) => x.requester_id === me)
            ? "sent"
            : "none";
      return { userId: r.id, displayName: r.display_name, imageUrl: r.image_url, relation };
    });
}
