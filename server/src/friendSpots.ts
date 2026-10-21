import type { FriendSpotDTO } from "@safesips/shared";
import { friendIds } from "./repos/friends.js";
import { eitherBlocked } from "./repos/moderation.js";
import { findUserById } from "./repos/users.js";
import { emitFriendSpot, emitFriendSpotRemoved } from "./realtime.js";

/**
 * Exact locations shown to friends — the ONE place a user's exact position
 * reaches the server, and only because they switched on "Friends see exactly
 * where I am" while sharing (it's off every time a share starts).
 *
 * - Kept in this process's memory only: never written to the database, never
 *   logged. A restart forgets it (the sharer's app sends it again).
 * - Only the latest spot per user; sent only to their accepted friends (and
 *   never across a block). Strangers keep seeing the anonymous circle.
 * - Dropped when they switch it off, stop sharing, their share runs out, or
 *   the friendship ends (unfriend / block).
 */
const spots = new Map<string, { lat: number; lng: number; updatedAt: number }>();

function visibleTo(viewerId: string, ownerId: string): boolean {
  return viewerId !== ownerId && !eitherBlocked(viewerId, ownerId);
}

function toDTO(userId: string): FriendSpotDTO | null {
  const spot = spots.get(userId);
  const user = spot ? findUserById(userId) : undefined;
  if (!spot || !user) return null;
  return {
    userId,
    displayName: user.display_name,
    imageUrl: user.image_url ?? null,
    lat: spot.lat,
    lng: spot.lng,
    updatedAt: spot.updatedAt,
  };
}

/** Save the sharer's latest exact spot and show it to their friends. */
export function setFriendSpot(userId: string, lat: number, lng: number, now = Date.now()): void {
  spots.set(userId, { lat, lng, updatedAt: now });
  const dto = toDTO(userId);
  if (!dto) return;
  for (const friendId of friendIds(userId)) {
    if (visibleTo(friendId, userId)) emitFriendSpot(friendId, dto);
  }
}

/** Forget the user's spot and take it off their friends' maps. */
export function clearFriendSpot(userId: string): void {
  if (!spots.delete(userId)) return;
  for (const friendId of friendIds(userId)) emitFriendSpotRemoved(friendId, userId);
}

export function hasFriendSpot(userId: string): boolean {
  return spots.has(userId);
}

/** The exact spots of my friends who are showing theirs right now. */
export function friendSpotsFor(viewerId: string): FriendSpotDTO[] {
  const out: FriendSpotDTO[] = [];
  for (const friendId of friendIds(viewerId)) {
    if (!spots.has(friendId) || !visibleTo(viewerId, friendId)) continue;
    const dto = toDTO(friendId);
    if (dto) out.push(dto);
  }
  return out;
}

/** A and B stopped being friends (unfriend or block): hide each one's spot from the other. */
export function hideSpotsBetween(a: string, b: string): void {
  if (spots.has(a)) emitFriendSpotRemoved(b, a);
  if (spots.has(b)) emitFriendSpotRemoved(a, b);
}

/** A and B just became friends: each sees the other's spot if they're showing one. */
export function showSpotsBetween(a: string, b: string): void {
  for (const [owner, viewer] of [
    [a, b],
    [b, a],
  ] as const) {
    const dto = spots.has(owner) && visibleTo(viewer, owner) ? toDTO(owner) : null;
    if (dto) emitFriendSpot(viewer, dto);
  }
}

/** Tests: forget everything. */
export function resetFriendSpots(): void {
  spots.clear();
}
