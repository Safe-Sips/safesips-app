import type {
  FriendDTO,
  FriendProfileDTO,
  FriendRequestDTO,
  FriendsOverviewDTO,
  OutgoingFriendRequestDTO,
} from "@safesips/shared";
import { db } from "../db.js";
import { genId, normalizeEmail, nowMs } from "../util.js";
import { ensureContactCode, formatCode, normalizeCode } from "./emergencyContacts.js";
import { computeStats } from "./stats.js";

/**
 * Friends: SafeSips users who accepted each other. Added by SafeSips code or
 * account email; the other person must accept. Friends can see each other's
 * profile and ask each other to be an emergency contact.
 */

/** Max new friend requests one user can send per 24 h (anti-spam). */
export const MAX_FRIEND_REQUESTS_PER_DAY = 30;

interface FriendshipRow {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: number;
  responded_at: number | null;
}

const userByCode = db.prepare(`SELECT id FROM users WHERE contact_code = ?`);
const userByEmail = db.prepare(`SELECT id FROM users WHERE email_norm = ?`);
const userRow = db.prepare(`SELECT id, display_name, email_norm, created_at FROM users WHERE id = ?`);
const countRecent = db.prepare(
  `SELECT COUNT(*) AS c FROM friendships WHERE requester_id = ? AND created_at > ?`
);
const pairRow = db.prepare(
  `SELECT * FROM friendships
    WHERE (requester_id = @a AND addressee_id = @b) OR (requester_id = @b AND addressee_id = @a)`
);
const insertRow = db.prepare(
  `INSERT INTO friendships (id, requester_id, addressee_id, invite_label, status, created_at)
   VALUES (@id, @requester_id, @addressee_id, @invite_label, 'pending', @created_at)`
);
const acceptRow = db.prepare(
  `UPDATE friendships SET status = 'accepted', responded_at = ? WHERE id = ?`
);
const deleteRow = db.prepare(`DELETE FROM friendships WHERE id = ?`);
const rowById = db.prepare(`SELECT * FROM friendships WHERE id = ?`);
const friendsOf = db.prepare(
  `SELECT f.id, f.responded_at, f.created_at, u.id AS user_id, u.display_name
     FROM friendships f
     JOIN users u ON u.id = CASE WHEN f.requester_id = @me THEN f.addressee_id ELSE f.requester_id END
    WHERE f.status = 'accepted' AND (f.requester_id = @me OR f.addressee_id = @me)
    ORDER BY u.display_name COLLATE NOCASE`
);
const incomingFor = db.prepare(
  `SELECT f.id, f.created_at, u.display_name AS from_name
     FROM friendships f JOIN users u ON u.id = f.requester_id
    WHERE f.status = 'pending' AND f.addressee_id = ?
    ORDER BY f.created_at DESC`
);
const outgoingFor = db.prepare(
  `SELECT id, invite_label, created_at FROM friendships
    WHERE status = 'pending' AND requester_id = ? ORDER BY created_at DESC`
);
const myContactLink = db.prepare(
  `SELECT status FROM emergency_links WHERE owner_id = ? AND contact_user_id = ?`
);

export type FriendRequestResult =
  | { ok: true; message: string; notify: { userId: string; accepted: boolean } | null }
  | { ok: false; error: string };

/**
 * Send a friend request by SafeSips code or account email. An email gets the
 * same reply whether or not it has an account, so this can't be used to find
 * out who uses SafeSips. If they had already asked me, this accepts it.
 */
export const requestFriend = db.transaction((me: string, identifier: string): FriendRequestResult => {
  const raw = identifier.trim();
  if (!raw) return { ok: false, error: "Enter their SafeSips code or email." };
  const since = nowMs() - 24 * 60 * 60 * 1000;
  if ((countRecent.get(me, since) as { c: number }).c >= MAX_FRIEND_REQUESTS_PER_DAY) {
    return { ok: false, error: "You've sent a lot of friend requests today. Try again tomorrow." };
  }

  let targetId: string | undefined;
  let label: string;
  const isEmail = raw.includes("@");
  if (isEmail) {
    const emailNorm = normalizeEmail(raw);
    const mine = (userRow.get(me) as { email_norm: string } | undefined)?.email_norm;
    if (emailNorm === mine) return { ok: false, error: "That's your own email." };
    targetId = (userByEmail.get(emailNorm) as { id: string } | undefined)?.id;
    label = emailNorm;
  } else {
    const code = normalizeCode(raw);
    if (!code) return { ok: false, error: "That isn't a valid SafeSips code (e.g. ABCD-2345) or email." };
    targetId = (userByCode.get(code) as { id: string } | undefined)?.id;
    if (!targetId) return { ok: false, error: "No SafeSips user has that code. Check it and try again." };
    if (targetId === me) return { ok: false, error: "That's your own code." };
    label = formatCode(code);
  }
  const sent = isEmail
    ? `Request sent to ${label}. If they use SafeSips, they'll see it there.`
    : "Friend request sent.";
  if (!targetId) return { ok: true, message: sent, notify: null };

  const existing = pairRow.get({ a: me, b: targetId }) as FriendshipRow | undefined;
  if (existing) {
    if (existing.status === "accepted") {
      return { ok: true, message: isEmail ? sent : "You're already friends.", notify: null };
    }
    if (existing.addressee_id === me) {
      // They asked me first: asking back means yes.
      acceptRow.run(nowMs(), existing.id);
      return {
        ok: true,
        message: isEmail ? sent : "You're now friends.",
        notify: { userId: targetId, accepted: true },
      };
    }
    return { ok: true, message: sent, notify: null };
  }
  insertRow.run({
    id: genId(),
    requester_id: me,
    addressee_id: targetId,
    invite_label: label,
    created_at: nowMs(),
  });
  return { ok: true, message: sent, notify: { userId: targetId, accepted: false } };
}) as (me: string, identifier: string) => FriendRequestResult;

export function getFriendsOverview(me: string): FriendsOverviewDTO {
  const friends = (friendsOf.all({ me }) as Array<{
    id: string;
    responded_at: number | null;
    created_at: number;
    user_id: string;
    display_name: string;
  }>).map<FriendDTO>((r) => ({
    id: r.id,
    userId: r.user_id,
    displayName: r.display_name,
    since: r.responded_at ?? r.created_at,
  }));
  const incoming = (incomingFor.all(me) as Array<{ id: string; created_at: number; from_name: string }>).map<FriendRequestDTO>(
    (r) => ({ id: r.id, fromDisplayName: r.from_name, createdAt: r.created_at })
  );
  const outgoing = (outgoingFor.all(me) as Array<{ id: string; invite_label: string; created_at: number }>).map<OutgoingFriendRequestDTO>(
    (r) => ({ id: r.id, label: r.invite_label, createdAt: r.created_at })
  );
  return { myCode: formatCode(ensureContactCode(me)), friends, incoming, outgoing };
}

/** Accept a request addressed to me. Returns the requester's id, or null. */
export function acceptFriend(me: string, friendshipId: string): string | null {
  const row = rowById.get(friendshipId) as FriendshipRow | undefined;
  if (!row || row.status !== "pending" || row.addressee_id !== me) return null;
  acceptRow.run(nowMs(), row.id);
  return row.requester_id;
}

/**
 * Decline a request, cancel one I sent, or unfriend. Returns the other
 * person's id (to refresh their view), or null if it isn't mine.
 */
export function removeFriendship(me: string, friendshipId: string): string | null {
  const row = rowById.get(friendshipId) as FriendshipRow | undefined;
  if (!row || (row.requester_id !== me && row.addressee_id !== me)) return null;
  deleteRow.run(row.id);
  return row.requester_id === me ? row.addressee_id : row.requester_id;
}

/** The accepted friendship between two users, if any. */
function acceptedFriendship(me: string, other: string): FriendshipRow | undefined {
  const row = pairRow.get({ a: me, b: other }) as FriendshipRow | undefined;
  return row?.status === "accepted" ? row : undefined;
}

export function areFriends(me: string, other: string): boolean {
  return acceptedFriendship(me, other) !== undefined;
}

/** A friend's profile; null unless we're friends. */
export function getFriendProfile(me: string, friendId: string): FriendProfileDTO | null {
  const friendship = acceptedFriendship(me, friendId);
  if (!friendship) return null;
  const user = userRow.get(friendId) as
    | { id: string; display_name: string; created_at: number }
    | undefined;
  if (!user) return null;
  const { counts } = computeStats(friendId);
  const link = myContactLink.get(me, friendId) as { status: "pending" | "accepted" } | undefined;
  return {
    userId: user.id,
    friendshipId: friendship.id,
    displayName: user.display_name,
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
