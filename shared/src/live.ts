import { distanceMeters } from "./mask";
import type { LatLng } from "./types";

/*
 * Live circle: while someone shares with the app open, their circle follows
 * them. Every publish gets a fresh random mask, so re-masking on every small
 * position fix would let an observer average many masked points back to the
 * true location. The circle therefore moves only in big steps, which also
 * keeps battery, network and server load tiny.
 */

/** Minimum real movement before the circle is re-published (metres). */
export const LIVE_MOVE_THRESHOLD_M = 100;

/** Minimum time between movement-triggered publishes (ms). */
export const LIVE_MIN_MOVE_INTERVAL_MS = 15_000;

/** Fixes less accurate than this are ignored (metres). */
export const LIVE_MAX_ACCURACY_M = 500;

/**
 * Should a new position fix move the circle?
 *
 * Yes only if the fix is accurate enough, the user really moved (by at least
 * the threshold, or by the fix's own accuracy if that's worse, so GPS/Wi-Fi
 * jitter doesn't count as movement), and enough time has passed since the
 * last publish. With no previous position (e.g. a resumed share) the first
 * good fix moves it.
 */
export function shouldMoveCircle(opts: {
  lastPublished: LatLng | null;
  here: LatLng;
  accuracyMeters: number;
  msSinceLastPublish: number;
}): boolean {
  if (opts.accuracyMeters > LIVE_MAX_ACCURACY_M) return false;
  if (opts.msSinceLastPublish < LIVE_MIN_MOVE_INTERVAL_MS) return false;
  if (!opts.lastPublished) return true;
  const moved = distanceMeters(opts.lastPublished, opts.here);
  return moved >= Math.max(LIVE_MOVE_THRESHOLD_M, opts.accuracyMeters);
}
