import type {
  UserSearchResultDTO,
  FriendDTO,
  FriendProfileDTO,
  FriendRequestDTO,
  FriendsOverviewDTO,
  OutgoingFriendRequestDTO,
} from "@safesips/shared";
import { db } from "../db.js";
import { genId, normalizeEmail, nowMs } from "../util.js";
import { ensureContactCode, formatCode, normalizeCode } from "./emergencyContacts.js";
import { computeCounts } from "./stats.js";

/**
 * Friends: SafeSips users who accepted each other. Added by SafeSips code or
 * account email; the other person must accept. Friends can see each other's
 * profile and ask each other to be an emergency contact.
 *
 * A request by email is always stored against the email (addressee_id NULL),
 * whether or not the address has an account, and matched to an account when
 * someone with that email looks or accepts. So the sender sees the same thing
 * either way and can't use this to find out who uses SafeSips.
 */

/** Max new friend requests one user can send per 24 h (anti-spam). */
export const MAX_FRIEND_REQUESTS_PER_DAY = 30;

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string | null;
  invite_email_norm: string | null;
  status: "pending" | "accepted";
  created_at: number;
  responded_at: number | null;
}

const userByCode = db.prepare(`SELECT id FROM users WHERE contact_code = ?`);
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
    ORDER BY f.created_at DESC`
);
const outgoingFor = db.prepare(
  `SELECT id, invite_label, created_at FROM friendships
    WHERE status = 'pending' AND requester_id = ? ORDER BY created_at DESC`
);
const discoverableOf = db.prepare(`SELECT discoverable FROM users WHERE id = ?`);
const setDiscoverableStmt = db.prepare(`UPDATE users SET discoverable = ?, updated_at = ? WHERE id = ?`);
/** Candidates for a name search: anyone discoverable whose name shares a letter run. */
const searchCandidates = db.prepare(
  `SELECT id, display_name, image_url FROM users
    WHERE discoverable = 1 AND status = 'active' AND id <> @me
      AND (display_name LIKE @contains ESCAPE '\\' OR display_name LIKE @start ESCAPE '\\'
           -- LIKE only folds ASCII: let accented names (Ștefan, Ioană) through
           -- to the precise, accent-insensitive ranking.
           OR display_name GLOB '*[^ -~]*')
    LIMIT 300`
);
const myContactLink = db.prepare(
  `SELECT status FROM emergency_links WHERE owner_id = ? AND contact_user_id = ?`
);

const emailOf = (userId: string): string =>
  (userRow.get(userId) as { email_norm: string } | undefined)?.email_norm ?? "";

function between(a: string, b: string): FriendshipRow[] {
  return rowsBetween.all({ a, b, aEmail: emailOf(a), bEmail: emailOf(b) }) as FriendshipRow[];
}

/** Is this pending row addressed to me (by account or by my email)? */
function addressedTo(row: FriendshipRow, me: string): boolean {
  if (row.requester_id === me) return false;
  return row.addressee_id === me || (row.addressee_id === null && row.invite_email_norm === emailOf(me));
}

/**
 * Accept `row` as `me`. It becomes the one friendship between us; any other
 * request either of us sent the other (by code or by email) is dropped.
 */
function acceptAs(me: string, row: FriendshipRow): void {
  for (const other of between(me, row.requester_id)) {
    if (other.id !== row.id) deleteRow.run(other.id);
  }
  acceptRow.run(me, nowMs(), row.id);
}

export type FriendRequestResult =
  | { ok: true; message: string; notify: { userId: string; accepted: boolean } | null }
  | { ok: false; error: string };

/**
 * Send a friend request by SafeSips code or account email. If they had
 * already asked me, asking back accepts it.
 */
export const requestFriend = db.transaction((me: string, identifier: string): FriendRequestResult => {
  const raw = identifier.trim();
  if (!raw) return { ok: false, error: "Enter their SafeSips code or email." };
  const since = nowMs() - 24 * 60 * 60 * 1000;
  if ((countRecent.get(me, since) as { c: number }).c >= MAX_FRIEND_REQUESTS_PER_DAY) {
    return { ok: false, error: "You've sent a lot of friend requests today. Try again tomorrow." };
  }

  if (raw.includes("@")) {
    const emailNorm = normalizeEmail(raw);
    if (emailNorm === emailOf(me)) return { ok: false, error: "That's your own email." };
    const sent = `Request sent to ${emailNorm}. If they use SafeSips, they'll see it there.`;
    const targetId = (userByEmail.get(emailNorm) as { id: string } | undefined)?.id;
    if (targetId) {
      const rows = between(me, targetId);
      if (rows.some((r) => r.status === "accepted")) return { ok: true, message: sent, notify: null };
      const theirs = rows.find((r) => r.status === "pending" && addressedTo(r, me));
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
    return { ok: true, message: sent, notify: targetId ? { userId: targetId, accepted: false } : null };
  }

  const code = normalizeCode(raw);
  if (!code) return { ok: false, error: "That isn't a valid SafeSips code (e.g. ABCD-2345) or email." };
  const targetId = (userByCode.get(code) as { id: string } | undefined)?.id;
  if (!targetId) return { ok: false, error: "No SafeSips user has that code. Check it and try again." };
  if (targetId === me) return { ok: false, error: "That's your own code." };
  const rows = between(me, targetId);
  if (rows.some((r) => r.status === "accepted")) {
    return { ok: true, message: "You're already friends.", notify: null };
  }
  const theirs = rows.find((r) => r.status === "pending" && addressedTo(r, me));
  if (theirs) {
    acceptAs(me, theirs);
    return { ok: true, message: "You're now friends.", notify: { userId: targetId, accepted: true } };
  }
  if (rows.some((r) => r.requester_id === me && r.addressee_id === targetId)) {
    return { ok: true, message: "Friend request sent.", notify: null };
  }
  insertRow.run({
    id: genId(),
    requester_id: me,
    addressee_id: targetId,
    invite_email_norm: null,
    invite_label: formatCode(code),
    created_at: nowMs(),
  });
  return { ok: true, message: "Friend request sent.", notify: { userId: targetId, accepted: false } };
}) as (me: string, identifier: string) => FriendRequestResult;

export function getFriendsOverview(me: string): FriendsOverviewDTO {
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
  }));
  // One entry per person, even if they asked by both code and email.
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
    myCode: formatCode(ensureContactCode(me)),
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
 * Decline a request, cancel one I sent, or unfriend. Returns the other
 * person's id (to refresh their view; null for an email nobody uses), or
 * null overall if it isn't mine.
 */
export function removeFriendship(me: string, friendshipId: string): { other: string | null } | null {
  const row = rowById.get(friendshipId) as FriendshipRow | undefined;
  if (!row) return null;
  const sentByMe = row.requester_id === me;
  if (!sentByMe && row.addressee_id !== me && !addressedTo(row, me)) return null;
  deleteRow.run(row.id);
  if (!sentByMe) return { other: row.requester_id };
  const other =
    row.addressee_id ??
    (row.invite_email_norm
      ? ((userByEmail.get(row.invite_email_norm) as { id: string } | undefined)?.id ?? null)
      : null);
  return { other };
}

/** The accepted friendship between two users, if any. */
function acceptedFriendship(me: string, other: string): FriendshipRow | undefined {
  if (me === other) return undefined;
  return between(me, other).find((r) => r.status === "accepted");
}

export function areFriends(me: string, other: string): boolean {
  return acceptedFriendship(me, other) !== undefined;
}

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

export function setDiscoverable(userId: string, on: boolean): void {
  setDiscoverableStmt.run(on ? 1 : 0, nowMs(), userId);
}

/** Lower-case, accents stripped ("Ștefan" ~ "stefan"), spaces collapsed. */
export function foldName(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
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
 * Find people by display name. Only discoverable, active users other than me;
 * name and picture only. Rate-limited by the route.
 */
export function searchUsers(me: string, rawQuery: string): UserSearchResultDTO[] {
  const query = rawQuery.trim().slice(0, 60);
  if (foldName(query).length < SEARCH_MIN_CHARS) return [];
  // The LIKE pre-filter is case-insensitive for ASCII; typo matches are found
  // through a shared two-letter start, then ranked precisely below.
  const head = likeEscape(query.slice(0, 2));
  const rows = searchCandidates.all({
    me,
    contains: `%${likeEscape(query)}%`,
    start: `%${head}%`,
  }) as Array<{ id: string; display_name: string; image_url: string | null }>;

  const myEmail = emailOf(me);
  return rows
    .map((r) => ({ r, rank: matchRank(r.display_name, query) }))
    .filter((x): x is { r: (typeof rows)[number]; rank: number } => x.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.r.display_name.localeCompare(b.r.display_name))
    .slice(0, SEARCH_MAX_RESULTS)
    .map(({ r }) => {
      const rel = rowsBetween.all({ a: me, b: r.id, aEmail: myEmail, bEmail: emailOf(r.id) }) as FriendshipRow[];
      const relation: UserSearchResultDTO["relation"] = rel.some((x) => x.status === "accepted")
        ? "friend"
        : rel.some((x) => x.status === "pending" && addressedTo(x, me))
          ? "received"
          : rel.some((x) => x.requester_id === me)
            ? "sent"
            : "none";
      return { userId: r.id, displayName: r.display_name, imageUrl: r.image_url, relation };
    });
}

/**
 * Send a friend request to someone picked from search. Only works for people
 * who are discoverable (or already connected to me), so ids can't be used to
 * reach people who opted out.
 */
export const requestFriendByUserId = db.transaction((me: string, targetId: string): FriendRequestResult => {
  if (targetId === me) return { ok: false, error: "That's you." };
  const target = userRow.get(targetId) as { id: string; display_name: string } | undefined;
  const rows = target ? between(me, targetId) : [];
  if (!target || (!isDiscoverable(targetId) && rows.length === 0)) {
    return { ok: false, error: "That person can't be found." };
  }
  const since = nowMs() - 24 * 60 * 60 * 1000;
  if ((countRecent.get(me, since) as { c: number }).c >= MAX_FRIEND_REQUESTS_PER_DAY) {
    return { ok: false, error: "You've sent a lot of friend requests today. Try again tomorrow." };
  }
  if (rows.some((r) => r.status === "accepted")) return { ok: true, message: "You're already friends.", notify: null };
  const theirs = rows.find((r) => r.status === "pending" && addressedTo(r, me));
  if (theirs) {
    acceptAs(me, theirs);
    return { ok: true, message: "You're now friends.", notify: { userId: targetId, accepted: true } };
  }
  if (rows.some((r) => r.requester_id === me && r.addressee_id === targetId)) {
    return { ok: true, message: "Friend request sent.", notify: null };
  }
  insertRow.run({
    id: genId(),
    requester_id: me,
    addressee_id: targetId,
    invite_email_norm: null,
    invite_label: target.display_name,
    created_at: nowMs(),
  });
  return { ok: true, message: "Friend request sent.", notify: { userId: targetId, accepted: false } };
}) as (me: string, targetId: string) => FriendRequestResult;
