import { clerkClient, isClerkNotFound, localUserForClerkId } from "./auth/clerk.js";
import { eitherBlocked } from "./repos/moderation.js";
import { areFriends, friendClerkIds, restoreFriendship } from "./repos/friends.js";
import { findUserById, markFriendsRestored, type UserRow } from "./repos/users.js";

/**
 * Friendships are backed up to each user's Clerk private metadata (only the
 * server can read or write it), so they survive the database being wiped —
 * on Render's free plan, every deploy starts with an empty database.
 *
 * - Whenever a friendship starts or ends, both people's lists are saved again
 *   from the database (the source of truth).
 * - The first time someone uses this database (`friends_restored` = 0), their
 *   saved list is restored before anything else. A friendship comes back only
 *   if BOTH lists still name each other, so an unfriend or a block that was
 *   saved on either side is never undone.
 * - A list is never saved over before it was restored, or a wipe followed by
 *   a new friendship would erase the old ones.
 */

/** Key in Clerk's privateMetadata. */
const METADATA_KEY = "safesipsFriends";
/** Clerk metadata is capped at 8 KB; a Clerk id is ~32 characters. */
const MAX_SAVED = 200;
/** After Clerk failed, wait this long before trying that user again. */
const RETRY_AFTER_MS = 60_000;

/** Where backups live. Clerk in production; tests pass their own. */
export interface FriendBackupStore {
  /** The saved friend list ([] if none); throws when the store can't be reached. */
  read(clerkId: string): Promise<string[]>;
  write(clerkId: string, friendClerkIds: string[]): Promise<void>;
  /** The local account for that id (created if needed), or null if it no longer exists. */
  localUser(clerkId: string): Promise<UserRow | null>;
}

function clerkStore(): FriendBackupStore | null {
  const client = clerkClient();
  if (!client) return null;
  return {
    async read(clerkId) {
      let user;
      try {
        user = await client.users.getUser(clerkId);
      } catch (err) {
        if (isClerkNotFound(err)) return [];
        throw err;
      }
      const saved = (user.privateMetadata as Record<string, unknown> | undefined)?.[METADATA_KEY];
      return Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : [];
    },
    async write(clerkId, ids) {
      await client.users.updateUserMetadata(clerkId, { privateMetadata: { [METADATA_KEY]: ids } });
    },
    localUser: localUserForClerkId,
  };
}

let storeOverride: FriendBackupStore | null | undefined;
/** Tests: use this store instead of Clerk (null = no backups). */
export function setFriendBackupStore(store: FriendBackupStore | null | undefined): void {
  storeOverride = store;
}
const store = () => (storeOverride !== undefined ? storeOverride : clerkStore());

/**
 * Bring back `user`'s saved friendships. Returns false (and leaves the user
 * un-restored, to retry later) if the store couldn't be reached.
 */
export async function restoreFriends(user: UserRow, backups: FriendBackupStore): Promise<boolean> {
  if (!user.clerk_id) {
    markFriendsRestored(user.id);
    return true;
  }
  try {
    const saved = (await backups.read(user.clerk_id)).slice(0, MAX_SAVED);
    for (const friendClerkId of saved) {
      if (friendClerkId === user.clerk_id) continue;
      const friend = await backups.localUser(friendClerkId);
      if (!friend || friend.id === user.id || areFriends(user.id, friend.id)) continue;
      if (eitherBlocked(user.id, friend.id)) continue;
      // Only if they still have me too (neither side unfriended or blocked).
      if (!(await backups.read(friendClerkId)).includes(user.clerk_id)) continue;
      restoreFriendship(user.id, friend.id);
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("[friends] couldn't restore saved friends:", err instanceof Error ? err.message : err);
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
    console.warn("[friends] backup failed:", err instanceof Error ? err.message : err);
  });
  queues.set(userId, next);
  void next.then(() => {
    if (queues.get(userId) === next) queues.delete(userId);
  });
  return next;
}

const lastFailure = new Map<string, number>();

/** Restore (if this database hasn't yet) and save the user's list. */
async function sync(userId: string, backups: FriendBackupStore): Promise<void> {
  const user = findUserById(userId);
  if (!user?.clerk_id) return;
  if (!user.friends_restored) {
    const failedAt = lastFailure.get(userId);
    if (failedAt !== undefined && Date.now() - failedAt < RETRY_AFTER_MS) return;
    if (!(await restoreFriends(user, backups))) {
      lastFailure.set(userId, Date.now());
      return;
    }
    lastFailure.delete(userId);
  }
  await backups.write(user.clerk_id, friendClerkIds(userId).slice(0, MAX_SAVED));
}

/**
 * Before serving a user this database hasn't restored yet, bring back their
 * friends. Never throws; at most one attempt a minute while Clerk is down.
 */
export async function ensureFriendsRestored(user: UserRow): Promise<void> {
  const backups = store();
  if (user.friends_restored || !user.clerk_id || !backups) return;
  await enqueue(user.id, () => sync(user.id, backups));
}

/**
 * Save these users' friend lists again, in the background (after a friendship
 * starts or ends). One after the other, in the order given: pass the person
 * who acted first, so when the other one is restored, the acting person's
 * new list is already saved (else an unfriend could be undone).
 */
export function backUpFriends(...userIds: Array<string | null | undefined>): void {
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
export async function friendBackupsSettled(): Promise<void> {
  while (queues.size > 0) await Promise.all([...queues.values()]);
}
