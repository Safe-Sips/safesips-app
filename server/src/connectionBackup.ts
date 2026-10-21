import fs from "node:fs";
import { clerkClient, isClerkNotFound, localUserForClerkId } from "./auth/clerk.js";
import { config } from "./config.js";
import {
  contactClerkIds,
  hasAcceptedLink,
  protectingClerkIds,
  restoreContactLink,
} from "./repos/emergencyContacts.js";
import { eitherBlocked } from "./repos/moderation.js";
import { areFriends, friendClerkIds, restoreFriendship } from "./repos/friends.js";
import {
  findUserByClerkId,
  findUserById,
  markFriendsRestored,
  upsertUserFromClerk,
  type UserRow,
} from "./repos/users.js";

/**
 * Friendships and accepted emergency contacts are backed up to each user's
 * Clerk private metadata (only the server can read or write it), so they
 * survive the database being wiped — on Render's free plan, every deploy
 * starts with an empty database.
 *
 * - Whenever a friendship or an emergency-contact link starts or ends, both
 *   people's lists are saved again from the database (the source of truth).
 * - The first time someone uses this database (`friends_restored` = 0), their
 *   saved lists are restored before anything else. A connection comes back
 *   only if BOTH sides still name each other (a friend lists the other as a
 *   friend; an owner lists the contact, and the contact lists the owner as
 *   someone they look out for), so an unfriend, a removal, a step-down or a
 *   block saved on either side is never undone.
 * - Lists are never saved over before they were restored, or a wipe followed
 *   by a new connection would erase the old ones.
 *
 * Only the links come back: pending requests, check-in plans and alerts
 * don't.
 */

/** Keys in Clerk's privateMetadata. */
const KEYS = {
  friends: "safesipsFriends",
  contacts: "safesipsContacts",
  protecting: "safesipsProtecting",
} as const;
/**
 * Clerk metadata is capped at 8 KB and a saved Clerk id takes ~35 bytes, so
 * each list has its own cap (~6 KB in all).
 */
const MAX_SAVED = { friends: 100, contacts: 25, protecting: 50 } as const;
/** After Clerk failed, wait this long before trying that user again. */
const RETRY_AFTER_MS = 60_000;

/** One user's saved connections, as Clerk ids. */
export interface SavedConnections {
  friends: string[];
  /** My accepted emergency contacts. */
  contacts: string[];
  /** People who have me as an accepted emergency contact. */
  protecting: string[];
}

/** Where backups live. Clerk in production; tests pass their own. */
export interface ConnectionBackupStore {
  /** The saved lists (empty if none); throws when the store can't be reached. */
  read(clerkId: string): Promise<SavedConnections>;
  write(clerkId: string, saved: SavedConnections): Promise<void>;
  /** The local account for that id (created if needed), or null if it no longer exists. */
  localUser(clerkId: string): Promise<UserRow | null>;
}

const EMPTY: SavedConnections = { friends: [], contacts: [], protecting: [] };

function idList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

function clerkStore(): ConnectionBackupStore | null {
  const client = clerkClient();
  if (!client) return null;
  return {
    async read(clerkId) {
      let user;
      try {
        user = await client.users.getUser(clerkId);
      } catch (err) {
        if (isClerkNotFound(err)) return EMPTY;
        throw err;
      }
      const meta = (user.privateMetadata ?? {}) as Record<string, unknown>;
      return {
        friends: idList(meta[KEYS.friends]),
        contacts: idList(meta[KEYS.contacts]),
        protecting: idList(meta[KEYS.protecting]),
      };
    },
    async write(clerkId, saved) {
      await client.users.updateUserMetadata(clerkId, {
        privateMetadata: {
          [KEYS.friends]: saved.friends,
          [KEYS.contacts]: saved.contacts,
          [KEYS.protecting]: saved.protecting,
        },
      });
    },
    localUser: localUserForClerkId,
  };
}

/**
 * Dev/CI only: a JSON file standing in for Clerk, so end-to-end tests can wipe
 * a real server's database and check what comes back. Only with test tokens
 * on, which is never the case on a hosted deploy (config.isHostedDeploy).
 */
function fileStore(file: string): ConnectionBackupStore {
  type Entry = SavedConnections & { email: string; displayName: string };
  const load = (): Record<string, Entry> => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, Entry>;
    } catch {
      return {};
    }
  };
  return {
    async read(clerkId) {
      const e = load()[clerkId];
      return e ? { friends: e.friends, contacts: e.contacts, protecting: e.protecting } : EMPTY;
    },
    async write(clerkId, saved) {
      const all = load();
      const user = findUserByClerkId(clerkId);
      all[clerkId] = {
        ...saved,
        email: user?.email ?? all[clerkId]?.email ?? "",
        displayName: user?.display_name ?? all[clerkId]?.displayName ?? "",
      };
      fs.writeFileSync(file, JSON.stringify(all));
    },
    async localUser(clerkId) {
      const existing = findUserByClerkId(clerkId);
      if (existing) return existing;
      const e = load()[clerkId];
      if (!e?.email) return null;
      return upsertUserFromClerk({ clerkId, email: e.email, displayName: e.displayName, emailVerified: true });
    },
  };
}
const testBackupFile = config.allowTestToken ? process.env.CONNECTION_BACKUP_FILE?.trim() : undefined;

let storeOverride: ConnectionBackupStore | null | undefined;
/** Tests: use this store instead of Clerk (null = no backups). */
export function setConnectionBackupStore(store: ConnectionBackupStore | null | undefined): void {
  storeOverride = store;
}
const store = () =>
  storeOverride !== undefined ? storeOverride : testBackupFile ? fileStore(testBackupFile) : clerkStore();

/** Dev/CI: the file store is on (test-token users then get Clerk-style ids). */
export function usesTestBackupFile(): boolean {
  return Boolean(testBackupFile);
}

/**
 * How many connections are saved for this user right now, as the app shows it
 * ("saved to your account"). Waits for saves still on their way. Null when
 * backups aren't available (no Clerk) or can't be read just now.
 */
export async function savedConnectionCounts(
  user: UserRow
): Promise<{ friends: number; contacts: number; protecting: number } | null> {
  const backups = store();
  if (!backups || !user.clerk_id) return null;
  await queues.get(user.id);
  try {
    const saved = await backups.read(user.clerk_id);
    return { friends: saved.friends.length, contacts: saved.contacts.length, protecting: saved.protecting.length };
  } catch {
    return null;
  }
}

/** What the database says `userId` has right now. */
function currentConnections(userId: string): SavedConnections {
  return {
    friends: friendClerkIds(userId).slice(0, MAX_SAVED.friends),
    contacts: contactClerkIds(userId).slice(0, MAX_SAVED.contacts),
    protecting: protectingClerkIds(userId).slice(0, MAX_SAVED.protecting),
  };
}

/**
 * Bring back `user`'s saved friendships and emergency contacts. Returns false
 * (and leaves the user un-restored, to retry later) if the store couldn't be
 * reached.
 */
export async function restoreConnections(user: UserRow, backups: ConnectionBackupStore): Promise<boolean> {
  if (!user.clerk_id) {
    markFriendsRestored(user.id);
    return true;
  }
  const me = user.clerk_id;
  try {
    // Each person's lists are read once per restore.
    const cache = new Map<string, SavedConnections>();
    const read = async (clerkId: string) => {
      let saved = cache.get(clerkId);
      if (!saved) {
        saved = await backups.read(clerkId);
        cache.set(clerkId, saved);
      }
      return saved;
    };
    /** The other person's local account, unless they're gone, me, or blocked. */
    const other = async (clerkId: string) => {
      if (clerkId === me) return null;
      const u = await backups.localUser(clerkId);
      return u && u.id !== user.id && !eitherBlocked(user.id, u.id) ? u : null;
    };

    const mine = await read(me);
    for (const id of mine.friends.slice(0, MAX_SAVED.friends)) {
      const friend = await other(id);
      if (!friend || areFriends(user.id, friend.id)) continue;
      if ((await read(id)).friends.includes(me)) restoreFriendship(user.id, friend.id);
    }
    // My emergency contacts: they must still list me as someone they look out for.
    for (const id of mine.contacts.slice(0, MAX_SAVED.contacts)) {
      const contact = await other(id);
      if (!contact || hasAcceptedLink(user.id, contact.id)) continue;
      if ((await read(id)).protecting.includes(me)) restoreContactLink(user.id, contact.id);
    }
    // People I look out for: they must still list me as their contact.
    for (const id of mine.protecting.slice(0, MAX_SAVED.protecting)) {
      const owner = await other(id);
      if (!owner || hasAcceptedLink(owner.id, user.id)) continue;
      if ((await read(id)).contacts.includes(me)) restoreContactLink(owner.id, user.id);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[backup] couldn't restore saved connections:", err instanceof Error ? err.message : err);
    return false;
  }
  markFriendsRestored(user.id);
  return true;
}

/** One backup job at a time per user, in order (so an older list never lands last). */
const queues = new Map<string, Promise<void>>();
function enqueue(userId: string, job: () => Promise<void>): Promise<void> {
  const next = (queues.get(userId) ?? Promise.resolve()).then(job).catch((err) => {
    // eslint-disable-next-line no-console
    console.warn("[backup] save failed:", err instanceof Error ? err.message : err);
  });
  queues.set(userId, next);
  void next.then(() => {
    if (queues.get(userId) === next) queues.delete(userId);
  });
  return next;
}

const lastFailure = new Map<string, number>();

/** Restore (if this database hasn't yet) and save the user's lists. */
async function sync(userId: string, backups: ConnectionBackupStore): Promise<void> {
  const user = findUserById(userId);
  if (!user?.clerk_id) return;
  if (!user.friends_restored) {
    const failedAt = lastFailure.get(userId);
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS) return;
    if (!(await restoreConnections(user, backups))) {
      lastFailure.set(userId, Date.now());
      return;
    }
    lastFailure.delete(userId);
  }
  await backups.write(user.clerk_id, currentConnections(userId));
}

/**
 * Before serving a user this database hasn't restored yet, bring back their
 * friends and emergency contacts. Never throws; at most one attempt a minute
 * while Clerk is down.
 */
export async function ensureConnectionsRestored(user: UserRow): Promise<void> {
  const backups = store();
  if (user.friends_restored || !user.clerk_id || !backups) return;
  await enqueue(user.id, () => sync(user.id, backups));
}

/**
 * Save these users' lists again, in the background (after a friendship or an
 * emergency-contact link starts or ends). One after the other, in the order
 * given: pass the person who acted first, so when the other one is restored,
 * the acting person's new lists are already saved (else a removal could be
 * undone).
 */
export function backUpConnections(...userIds: Array<string | null | undefined>): void {
  const backups = store();
  if (!backups) return;
  let previous: Promise<void> = Promise.resolve();
  for (const id of new Set(userIds)) {
    if (!id) continue;
    const after = previous;
    previous = enqueue(id, async () => {
      await after;
      await sync(id, backups);
    });
  }
}

/** Tests: wait for queued backups to finish. */
export async function connectionBackupsSettled(): Promise<void> {
  while (queues.size > 0) await Promise.all([...queues.values()]);
}
