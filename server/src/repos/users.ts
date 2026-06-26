import type { UserDTO } from "@safesips/shared";
import { db } from "../db.js";
import { genId, normalizeEmail, nowMs } from "../util.js";

export interface UserRow {
  id: string;
  email: string;
  email_norm: string;
  password_hash: string;
  display_name: string;
  email_verified: number;
  status: string;
  created_at: number;
  updated_at: number;
}

const insertUser = db.prepare(
  `INSERT INTO users
     (id, email, email_norm, password_hash, display_name, email_verified, status, created_at, updated_at)
   VALUES
     (@id, @email, @email_norm, @password_hash, @display_name, @email_verified, @status, @created_at, @updated_at)`
);
const selectByEmail = db.prepare(`SELECT * FROM users WHERE email_norm = ?`);
const selectById = db.prepare(`SELECT * FROM users WHERE id = ?`);
const updateVerified = db.prepare(
  `UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`
);

export function findUserByEmail(email: string): UserRow | undefined {
  return selectByEmail.get(normalizeEmail(email)) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return selectById.get(id) as UserRow | undefined;
}

export function createUser(params: {
  email: string;
  displayName: string;
  passwordHash: string;
}): UserRow {
  const now = nowMs();
  const row: UserRow = {
    id: genId(),
    email: params.email.trim(),
    email_norm: normalizeEmail(params.email),
    password_hash: params.passwordHash,
    display_name: params.displayName.trim(),
    email_verified: 0,
    status: "active",
    created_at: now,
    updated_at: now,
  };
  insertUser.run(row);
  return row;
}

export function markEmailVerified(id: string): void {
  updateVerified.run(nowMs(), id);
}

export function toUserDTO(row: UserRow): UserDTO {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    emailVerified: row.email_verified === 1,
    createdAt: row.created_at,
  };
}
