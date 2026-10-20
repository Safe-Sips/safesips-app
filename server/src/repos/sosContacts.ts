import type { SosContactDTO } from "@safesips/shared";
import type { NotifyContact } from "../notify.js";
import { db } from "../db.js";
import { genId, nowMs } from "../util.js";

interface ContactRow {
  id: string;
  user_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  is_primary: number;
  created_at: number;
}

const selectByUser = db.prepare(
  `SELECT * FROM sos_contacts WHERE user_id = ? ORDER BY is_primary DESC, created_at ASC`
);
const selectPrimary = db.prepare(
  `SELECT * FROM sos_contacts WHERE user_id = ? AND is_primary = 1 LIMIT 1`
);
const insertContact = db.prepare(
  `INSERT INTO sos_contacts (id, user_id, name, email, phone, is_primary, created_at)
   VALUES (@id, @user_id, @name, @email, @phone, @is_primary, @created_at)`
);
const clearPrimary = db.prepare(
  `UPDATE sos_contacts SET is_primary = 0 WHERE user_id = ?`
);
const deleteContactStmt = db.prepare(
  `DELETE FROM sos_contacts WHERE id = ? AND user_id = ?`
);

function toDTO(row: ContactRow): SosContactDTO {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    isPrimary: row.is_primary === 1,
    createdAt: row.created_at,
  };
}

export function listContacts(userId: string): SosContactDTO[] {
  return (selectByUser.all(userId) as ContactRow[]).map(toDTO);
}

export function getPrimaryContact(userId: string): NotifyContact | null {
  const row = selectPrimary.get(userId) as ContactRow | undefined;
  if (!row) return null;
  return { id: row.id, name: row.name, email: row.email, phone: row.phone };
}

/** Everyone to alert when a check-in is missed (primary first). */
export function listAlertContacts(userId: string): NotifyContact[] {
  return (selectByUser.all(userId) as ContactRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
  }));
}

/** One of the user's contacts, or undefined. */
export function getContact(userId: string, id: string): NotifyContact | undefined {
  return listAlertContacts(userId).find((c) => c.id === id);
}

/** True when at least one contact has a phone or email to alert. */
export function hasReachableContact(userId: string): boolean {
  return listAlertContacts(userId).some((c) => !!(c.phone || c.email));
}

/** Create a contact. When marked primary, demote any existing primary first. */
export const createContact = db.transaction(
  (
    userId: string,
    input: {
      name: string;
      email: string | null;
      phone: string | null;
      isPrimary: boolean;
    }
  ): SosContactDTO => {
    // If this is the user's first contact, make it primary automatically.
    const existing = selectByUser.all(userId) as ContactRow[];
    const makePrimary = input.isPrimary || existing.length === 0;
    if (makePrimary) clearPrimary.run(userId);
    const id = genId();
    insertContact.run({
      id,
      user_id: userId,
      name: input.name,
      email: input.email,
      phone: input.phone,
      is_primary: makePrimary ? 1 : 0,
      created_at: nowMs(),
    });
    return {
      id,
      name: input.name,
      email: input.email,
      phone: input.phone,
      isPrimary: makePrimary,
      createdAt: nowMs(),
    };
  }
) as (
  userId: string,
  input: { name: string; email: string | null; phone: string | null; isPrimary: boolean }
) => SosContactDTO;

export function deleteContact(userId: string, id: string): boolean {
  return deleteContactStmt.run(id, userId).changes > 0;
}
