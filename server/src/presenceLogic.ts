/**
 * Pure, side-effect-free decisions for the realtime presence lifecycle.
 *
 * Kept out of index.ts so the tricky reconnect/disconnect rules can be unit
 * tested without standing up a socket.io server.
 */

/**
 * socket.io reports this reason only when the CLIENT deliberately closed the
 * connection (e.g. the web app calls `socket.disconnect()` on sign-out). Every
 * other reason — "transport close", "ping timeout", "transport error" — is an
 * involuntary drop (screen locked, app backgrounded, network blip, tab closed)
 * and must NOT remove the circle, so locations don't vanish the moment a phone
 * goes to sleep.
 */
export function isDeliberateDisconnect(reason: string): boolean {
  return reason === "client namespace disconnect";
}

export type ResumeDecision = "resume" | "skip" | "clear";

/**
 * Decide what a newly-connected socket should do about a circle the same user
 * already has from an earlier connection.
 *
 * - `resume`: restore the owner's "Sharing" UI and let this socket take over
 *   the circle (a genuine reload / reopen — the previous owner is gone).
 * - `skip`: do nothing. Either there is no existing share, or another live
 *   socket of this user still owns it — resuming here would hijack it and make
 *   the two sessions ping-pong the circle on every heartbeat.
 * - `clear`: the tracked share has already expired in the store; drop the
 *   stale bookkeeping entry.
 */
export function resumeDecision(opts: {
  hasExisting: boolean;
  recordExists: boolean;
  ownerConnected: boolean;
}): ResumeDecision {
  if (!opts.hasExisting) return "skip";
  if (!opts.recordExists) return "clear";
  if (opts.ownerConnected) return "skip";
  return "resume";
}

/**
 * True when a share that began at `startedAt` has reached the maximum
 * continuous duration and must be force-stopped. Based on an absolute start
 * time carried across reconnects, so the cap is real wall-clock time rather
 * than "time since the current socket connected".
 */
export function hasReachedMaxDuration(
  startedAt: number,
  now: number,
  maxDurationMs: number
): boolean {
  return now - startedAt >= maxDurationMs;
}
