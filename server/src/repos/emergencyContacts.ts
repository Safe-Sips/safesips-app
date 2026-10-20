import { randomInt } from "node:crypto";
import type {
  ContactRequestDTO,
  ContactsOverviewDTO,
  EmergencyContactDTO,
  ProtecteeDTO,
} from "@safesips/shared";
import { db } from "../db.js";
import { genId, normalizeEmail, nowMs } from "../util.js";

/**
 * In-app emergency contacts: links between SafeSips users. The owner (who
 * checks in) invites a contact by account email or SafeSips code; the contact
 * must accept before they receive alerts. Either side can remove the link.
 */

// No 0/O, 1/I/L: codes are read aloud and typed on phones.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;
/** Max new contact requests one user can send per 24 h (anti-spam). */
export const MAX_REQUESTS_PER_DAY = 20;

const selectCode = db.prepare(`SELECT contact_code FROM users WHERE id = ?`);
const setCode = db.prepare(`UPDATE users SET contact_code = ? WHERE id = ? AND contact_code IS NULL`);
const userByCode = db.prepare(`SELECT id FROM users WHERE contact_code = ?`);
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
  `SELECT l.id, l.status, l.invite_label, l.created_at, u.display_name
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

function newCode(): string {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return s;
}

/** "ABCD2345" → "ABCD-2345" for display. */
export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Accepts "abcd-2345", "ABCD 2345", … → "ABCD2345", or null if not a code. */
export function normalizeCode(raw: string): string | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return s.length === CODE_LENGTH && [...s].every((ch) => CODE_ALPHABET.includes(ch)) ? s : null;
}

/** The user's SafeSips code, created on first use. */
export function ensureContactCode(userId: string): string {
  const existing = (selectCode.get(userId) as { contact_code: string | null } | undefined)?.contact_code;
  if (existing) return existing;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      if (setCode.run(newCode(), userId).changes > 0) break;
    } catch {
      /* unique collision: try another */
    }
  }
  return (selectCode.get(userId) as { contact_code: string }).contact_code;
}

export type AddResult =
  | { ok: true; message: string; notifyUserId: string | null }
  | { ok: false; error: string };

/**
 * Ask someone to be my emergency contact, by account email or SafeSips code.
 * Email requests get the same reply whether or not the address has an account,
 * so this can't be used to find out who uses SafeSips.
 */
export function requestContact(ownerId: string, identifier: string): AddResult {
  const raw = identifier.trim();
  if (!raw) return { ok: false, error: "Enter their email or SafeSips code." };
  const since = nowMs() - 24 * 60 * 60 * 1000;
  if ((countRecentRequests.get(ownerId, since) as { c: number }).c >= MAX_REQUESTS_PER_DAY) {
    return { ok: false, error: "You've sent a lot of requests today. Try again tomorrow." };
  }

  if (raw.includes("@")) {
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

  const code = normalizeCode(raw);
  if (!code) return { ok: false, error: "That isn't a valid email or SafeSips code (e.g. ABCD-2345)." };
  const target = userByCode.get(code) as { id: string } | undefined;
  if (!target) return { ok: false, error: "No SafeSips user has that code. Check it and try again." };
  if (target.id === ownerId) return { ok: false, error: "That's your own code." };
  return linkToUser(ownerId, target.id, formatCode(code));
}

/** Pending link from owner to an existing user (no-op if one exists). */
function linkToUser(ownerId: string, targetId: string, label: string): AddResult {
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
    display_name: string | null;
  }>).map<EmergencyContactDTO>((r) => ({
    id: r.id,
    status: r.status,
    // Don't reveal who is behind an email/code until they accept.
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
  return { myCode: formatCode(ensureContactCode(userId)), contacts, incoming: requests, protecting: protects };
}

/** Accept a request addressed to me. Returns the requester's id, or null. */
export const acceptRequest = db.transaction((userId: string, linkId: string): string | null => {
  const email = (userEmailNorm.get(userId) as { email_norm: string } | undefined)?.email_norm ?? "";
  const link = pendingForMe.get({ id: linkId, me: userId, email }) as
    | { id: string; owner_id: string }
    | undefined;
  if (!link) return null;
  // If they'd also added me another way (code + email), keep just one link.
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
