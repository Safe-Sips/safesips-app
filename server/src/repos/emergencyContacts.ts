import type {
  ContactRequestDTO,
  ContactsOverviewDTO,
  EmergencyContactDTO,
  ProtecteeDTO,
} from "@safesips/shared";
import { db } from "../db.js";
import { genId, normalizeEmail, nowMs } from "../util.js";
import { eitherBlocked } from "./moderation.js";

/**
 * In-app emergency contacts: links between SafeSips users. The owner (who
 * checks in) invites a contact by account email or from their friends; the contact
 * must accept before they receive alerts. Either side can remove the link.
 */

/** Max new contact requests one user can send per 24 h (anti-spam). */
export const MAX_REQUESTS_PER_DAY = 20;

const userByEmail = db.prepare(`SELECT id FROM users WHERE email_norm = ?`);
const userEmailNorm = db.prepare(`SELECT email_norm FROM users WHERE id = ?`);
const countRecentRequests = db.prepare(
  `SELECT COUNT(*) AS c FROM emergency_links WHERE owner_id = ? AND created_at > ?`
);
const linkByOwnerContact = db.prepare(
  `SELECT id FROM emergency_links WHERE owner_id = ? AND contact_user_id = ?`
);
const linkByOwnerEmail = db.prepare(
  `SELECT id FROM emergency_links WHERE owner_id = ? AND contact_user_id IS NULL AND invite_email_norm = ?`
);
const insertLink = db.prepare(
  `INSERT INTO emergency_links (id, owner_id, contact_user_id, invite_email_norm, invite_label, status, created_at)
   VALUES (@id, @owner_id, @contact_user_id, @invite_email_norm, @invite_label, 'pending', @created_at)`
);
const outgoing = db.prepare(
  `SELECT l.id, l.status, l.invite_label, l.created_at, l.contact_user_id, u.display_name
     FROM emergency_links l LEFT JOIN users u ON u.id = l.contact_user_id
    WHERE l.owner_id = ? ORDER BY l.status = 'accepted' DESC, l.created_at ASC`
);
const incoming = db.prepare(
  `SELECT l.id, l.created_at, o.display_name AS from_name
     FROM emergency_links l JOIN users o ON o.id = l.owner_id
    WHERE l.status = 'pending'
      AND (l.contact_user_id = @me OR (l.contact_user_id IS NULL AND l.invite_email_norm = @email))
    ORDER BY l.created_at DESC`
);
const protecting = db.prepare(
  `SELECT l.id, o.display_name FROM emergency_links l JOIN users o ON o.id = l.owner_id
    WHERE l.status = 'accepted' AND l.contact_user_id = ? ORDER BY o.display_name`
);
const pendingForMe = db.prepare(
  `SELECT id, owner_id FROM emergency_links
    WHERE id = @id AND status = 'pending'
      AND (contact_user_id = @me OR (contact_user_id IS NULL AND invite_email_norm = @email))`
);
const acceptLink = db.prepare(
  `UPDATE emergency_links SET status = 'accepted', contact_user_id = ?, responded_at = ? WHERE id = ?`
);
const deleteLink = db.prepare(`DELETE FROM emergency_links WHERE id = ?`);
const linkParties = db.prepare(
  `SELECT owner_id, contact_user_id, invite_email_norm FROM emergency_links WHERE id = ?`
);
const acceptedContacts = db.prepare(
  `SELECT u.id, u.display_name, u.email FROM emergency_links l JOIN users u ON u.id = l.contact_user_id
    WHERE l.owner_id = ? AND l.status = 'accepted'`
);

export type AddResult =
  | { ok: true; message: string; notifyUserId: string | null }
  | { ok: false; error: string };

/**
 * Ask someone to be my emergency contact, by account email.
 * Email requests get the same reply whether or not the address has an account,
 * so this can't be used to find out who uses SafeSips.
 */
export function requestContact(ownerId: string, identifier: string): AddResult {
  const raw = identifier.trim();
  if (!raw) return { ok: false, error: "Enter their email." };
  const since = nowMs() - 24 * 60 * 60 * 1000;
  if ((countRecentRequests.get(ownerId, since) as { c: number }).c >= MAX_REQUESTS_PER_DAY) {
    return { ok: false, error: "You've sent a lot of requests today. Try again tomorrow." };
  }

  if (!raw.includes("@")) {
    return { ok: false, error: "Enter their email address, or pick one of your friends." };
  }
  const emailNorm = normalizeEmail(raw);
  const myEmail = (userEmailNorm.get(ownerId) as { email_norm: string } | undefined)?.email_norm;
  if (emailNorm === myEmail) return { ok: false, error: "That's your own email." };
  const target = userByEmail.get(emailNorm) as { id: string } | undefined;
  const exists = target
    ? linkByOwnerContact.get(ownerId, target.id)
    : linkByOwnerEmail.get(ownerId, emailNorm);
  if (!exists) {
    insertLink.run({
      id: genId(),
      owner_id: ownerId,
      contact_user_id: target?.id ?? null,
      invite_email_norm: emailNorm,
      invite_label: emailNorm,
      created_at: nowMs(),
    });
  }
  return {
    ok: true,
    message: `Request sent to ${emailNorm}. If they don't use SafeSips yet, they'll see it when they sign up with that email.`,
    notifyUserId: !exists && target ? target.id : null,
  };
}

/** Pending link from owner to an existing user (no-op if one exists). */
function linkToUser(ownerId: string, targetId: string, label: string): AddResult {
  // Someone who blocked me never gets my requests (same reply, nothing sent).
  if (eitherBlocked(ownerId, targetId)) return { ok: true, message: "Request sent.", notifyUserId: null };
  const exists = linkByOwnerContact.get(ownerId, targetId);
  if (!exists) {
    insertLink.run({
      id: genId(),
      owner_id: ownerId,
      contact_user_id: targetId,
      invite_email_norm: null,
      invite_label: label,
      created_at: nowMs(),
    });
  }
  return { ok: true, message: "Request sent.", notifyUserId: exists ? null : targetId };
}

/**
 * Ask a friend (by user id) to be my emergency contact. The caller checks we
 * are friends. They still have to accept, like any other request.
 */
export function requestContactForUser(ownerId: string, targetId: string): AddResult {
  if (targetId === ownerId) return { ok: false, error: "That's you." };
  const since = nowMs() - 24 * 60 * 60 * 1000;
  if ((countRecentRequests.get(ownerId, since) as { c: number }).c >= MAX_REQUESTS_PER_DAY) {
    return { ok: false, error: "You've sent a lot of requests today. Try again tomorrow." };
  }
  return linkToUser(ownerId, targetId, "Friend");
}

export function getOverview(userId: string): ContactsOverviewDTO {
  const email = (userEmailNorm.get(userId) as { email_norm: string } | undefined)?.email_norm ?? "";
  const contacts = (outgoing.all(userId) as Array<{
    id: string;
    status: "pending" | "accepted";
    invite_label: string;
    created_at: number;
    contact_user_id: string | null;
    display_name: string | null;
  }>).map<EmergencyContactDTO>((r) => ({
    id: r.id,
    status: r.status,
    userId: r.status === "accepted" ? r.contact_user_id : null,
    // Don't reveal who is behind an email until they accept.
    displayName: r.status === "accepted" ? r.display_name : null,
    inviteLabel: r.invite_label,
    createdAt: r.created_at,
  }));
  const requests = (incoming.all({ me: userId, email }) as Array<{
    id: string;
    created_at: number;
    from_name: string;
  }>).map<ContactRequestDTO>((r) => ({ id: r.id, fromDisplayName: r.from_name, createdAt: r.created_at }));
  const protects = (protecting.all(userId) as Array<{ id: string; display_name: string }>).map<ProtecteeDTO>(
    (r) => ({ id: r.id, displayName: r.display_name })
  );
  return { contacts, incoming: requests, protecting: protects };
}

/** Accept a request addressed to me. Returns the requester's id, or null. */
export const acceptRequest = db.transaction((userId: string, linkId: string): string | null => {
  const email = (userEmailNorm.get(userId) as { email_norm: string } | undefined)?.email_norm ?? "";
  const link = pendingForMe.get({ id: linkId, me: userId, email }) as
    | { id: string; owner_id: string }
    | undefined;
  if (!link) return null;
  // If they'd also added me another way (friend + email), keep just one link.
  const dup = linkByOwnerContact.get(link.owner_id, userId) as { id: string } | undefined;
  if (dup && dup.id !== link.id) deleteLink.run(dup.id);
  acceptLink.run(userId, nowMs(), link.id);
  return link.owner_id;
}) as (userId: string, linkId: string) => string | null;

/**
 * Remove a link — as the owner (stop alerting them), as the contact (stop
 * being their contact), or decline a request addressed to me. Returns the
 * other party's id (to refresh their view), or undefined if not allowed.
 */
export function removeLink(userId: string, linkId: string): { other: string | null } | undefined {
  const row = linkParties.get(linkId) as
    | { owner_id: string; contact_user_id: string | null; invite_email_norm: string | null }
    | undefined;
  if (!row) return undefined;
  const email = (userEmailNorm.get(userId) as { email_norm: string } | undefined)?.email_norm;
  const isOwner = row.owner_id === userId;
  const isContact =
    row.contact_user_id === userId || (row.contact_user_id === null && row.invite_email_norm === email);
  if (!isOwner && !isContact) return undefined;
  deleteLink.run(linkId);
  return { other: isOwner ? row.contact_user_id : row.owner_id };
}

/** The people to alert when this user misses a check-in. */
export function listAcceptedContacts(
  ownerId: string
): Array<{ id: string; displayName: string; email: string }> {
  return (acceptedContacts.all(ownerId) as Array<{ id: string; display_name: string; email: string }>).map(
    (r) => ({ id: r.id, displayName: r.display_name, email: r.email })
  );
}

export function hasAcceptedContact(ownerId: string): boolean {
  return listAcceptedContacts(ownerId).length > 0;
}

/* -------------------- Backup (see connectionBackup.ts) -------------------- */

const contactClerkIdsOf = db.prepare(
  `SELECT u.clerk_id FROM emergency_links l JOIN users u ON u.id = l.contact_user_id
    WHERE l.owner_id = ? AND l.status = 'accepted' AND u.clerk_id IS NOT NULL ORDER BY u.clerk_id`
);
const protectingClerkIdsOf = db.prepare(
  `SELECT u.clerk_id FROM emergency_links l JOIN users u ON u.id = l.owner_id
    WHERE l.contact_user_id = ? AND l.status = 'accepted' AND u.clerk_id IS NOT NULL ORDER BY u.clerk_id`
);
const acceptedLink = db.prepare(
  `SELECT 1 AS x FROM emergency_links WHERE owner_id = ? AND contact_user_id = ? AND status = 'accepted'`
);
const linksToUser = db.prepare(
  `SELECT l.id FROM emergency_links l LEFT JOIN users u ON u.id = ?
    WHERE l.owner_id = ? AND (l.contact_user_id = ? OR (l.contact_user_id IS NULL AND l.invite_email_norm = u.email_norm))`
);

/** Clerk ids of my accepted emergency contacts. */
export function contactClerkIds(ownerId: string): string[] {
  return (contactClerkIdsOf.all(ownerId) as Array<{ clerk_id: string }>).map((r) => r.clerk_id);
}

/** Clerk ids of the people who have me as an accepted emergency contact. */
export function protectingClerkIds(contactId: string): string[] {
  return (protectingClerkIdsOf.all(contactId) as Array<{ clerk_id: string }>).map((r) => r.clerk_id);
}

export function hasAcceptedLink(ownerId: string, contactId: string): boolean {
  return acceptedLink.get(ownerId, contactId) !== undefined;
}

/**
 * Put back an accepted link from a backup, replacing any pending request
 * between them. No-op if it's already there.
 */
export const restoreContactLink = db.transaction((ownerId: string, contactId: string): boolean => {
  if (ownerId === contactId || hasAcceptedLink(ownerId, contactId)) return false;
  for (const r of linksToUser.all(contactId, ownerId, contactId) as Array<{ id: string }>) deleteLink.run(r.id);
  const id = genId();
  insertLink.run({
    id,
    owner_id: ownerId,
    contact_user_id: contactId,
    invite_email_norm: null,
    invite_label: "Friend",
    created_at: nowMs(),
  });
  acceptLink.run(contactId, nowMs(), id);
  return true;
}) as (ownerId: string, contactId: string) => boolean;
