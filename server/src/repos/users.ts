import type { UserDTO } from "@safesips/shared";
import { config } from "../config.js";
import { db } from "../db.js";
import { foldName, genId, normalizeEmail, nowMs } from "../util.js";

export interface UserRow {
  id: string;
  email: string;
  email_norm: string;
  password_hash: string;
  display_name: string;
  email_verified: number;
  status: string;
  clerk_id: string | null;
  image_url?: string | null;
  discoverable?: number;
  search_notice_seen?: number;
  /** 1 once friendships saved in Clerk were restored into this database. */
  friends_restored?: number;
  created_at: number;
  updated_at: number;
}

const insertUser = db.prepare(
  `INSERT INTO users
     (id, email, email_norm, password_hash, display_name, name_search, email_verified, status, clerk_id, created_at, updated_at)
   VALUES
     (@id, @email, @email_norm, @password_hash, @display_name, @name_search, @email_verified, @status, @clerk_id, @created_at, @updated_at)`
);
const selectByEmail = db.prepare(`SELECT * FROM users WHERE email_norm = ?`);
const selectById = db.prepare(`SELECT * FROM users WHERE id = ?`);
const selectByClerkId = db.prepare(`SELECT * FROM users WHERE clerk_id = ?`);
const updateVerified = db.prepare(
  `UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?`
);
const updateClerkId = db.prepare(
  `UPDATE users SET clerk_id = ?, email_verified = ?, display_name = ?, name_search = ?, updated_at = ? WHERE id = ?`
);

const updateImage = db.prepare(`UPDATE users SET image_url = ?, updated_at = ? WHERE id = ?`);
const setFriendsRestored = db.prepare(`UPDATE users SET friends_restored = 1 WHERE id = ?`);

/** Friendships saved in Clerk are now in this database (see friendBackup.ts). */
export function markFriendsRestored(userId: string): void {
  setFriendsRestored.run(userId);
}

/** Hosts Clerk serves profile pictures from. Nothing else is accepted. */
const AVATAR_HOSTS = new Set(["img.clerk.com", "images.clerk.dev"]);

/**
 * A profile picture URL we're willing to show other people: https on a Clerk
 * image host. (An arbitrary URL would let someone log every friend's IP when
 * their profile loads.) Returns the cleaned URL, or null if not acceptable.
 */
export function cleanAvatarUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !AVATAR_HOSTS.has(url.hostname)) return null;
    if (url.username || url.password || url.port) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function setUserImage(userId: string, imageUrl: string | null): void {
  updateImage.run(imageUrl, nowMs(), userId);
}

export function findUserByEmail(email: string): UserRow | undefined {
  return selectByEmail.get(normalizeEmail(email)) as UserRow | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return selectById.get(id) as UserRow | undefined;
}

export function findUserByClerkId(clerkId: string): UserRow | undefined {
  return selectByClerkId.get(clerkId) as UserRow | undefined;
}

/** Create or attach a local user for a verified Clerk account. */
export function upsertUserFromClerk(params: {
  clerkId: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
}): UserRow {
  const now = nowMs();
  const existingByClerk = findUserByClerkId(params.clerkId);
  if (existingByClerk) {
    const name = params.displayName.trim() || existingByClerk.display_name;
    updateClerkId.run(params.clerkId, params.emailVerified ? 1 : 0, name, foldName(name), now, existingByClerk.id);
    return findUserByClerkId(params.clerkId)!;
  }
  const existingByEmail = findUserByEmail(params.email);
  if (existingByEmail) {
    const name = params.displayName.trim() || existingByEmail.display_name;
    updateClerkId.run(
      params.clerkId,
      params.emailVerified ? 1 : existingByEmail.email_verified,
      name,
      foldName(name),
      now,
      existingByEmail.id
    );
    return findUserById(existingByEmail.id)!;
  }
  const row: UserRow = {
    id: genId(),
    email: params.email.trim(),
    email_norm: normalizeEmail(params.email),
    password_hash: "!",
    display_name: params.displayName.trim() || "SafeSips user",
    email_verified: params.emailVerified ? 1 : 0,
    status: "active",
    clerk_id: params.clerkId,
    created_at: now,
    updated_at: now,
  };
  insertUser.run({ ...row, name_search: foldName(row.display_name) });
  return findUserById(row.id)!;
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
    clerk_id: null,
    created_at: now,
    updated_at: now,
  };
  insertUser.run({ ...row, name_search: foldName(row.display_name) });
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
    imageUrl: row.image_url ?? null,
    discoverable: row.discoverable !== 0,
    searchNoticePending: row.search_notice_seen === 0,
    isAdmin: config.adminEmails.includes(row.email_norm),
  };
}
