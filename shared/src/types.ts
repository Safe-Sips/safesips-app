/**
 * Wire types shared between the SafeSips clients (web + mobile) and the
 * real-time server.
 *
 * Privacy invariant: none of these types ever carry the user's exact
 * coordinates. Only the randomized public center is transmitted.
 */

/** Fixed public privacy radius, in meters. */
export const PUBLIC_RADIUS_METERS = 200;

/** Maximum random offset applied to the exact location, in meters. */
export const MASK_RADIUS_METERS = 50;

/** How often a sharing client re-publishes to keep its presence alive (ms). */
export const PRESENCE_HEARTBEAT_MS = 45_000;

/**
 * Emergency number shown in the UI and in SOS alert emails. SafeSips targets
 * Romania / the EU, where 112 is the universal emergency number.
 */
export const EMERGENCY_NUMBER = "112";

/** Maximum continuous sharing duration before auto-stop (ms). */
export const SHARE_MAX_DURATION_MS = 24 * 60 * 60 * 1000;

/**
 * "Share for" choices offered in the UI. `0` means live mode: the circle stays
 * only while the app keeps sending heartbeats (plus the server's grace period).
 * Any other value keeps the last known circle visible for that long, even if
 * the phone locks or the app is closed, until the user taps Stop.
 */
export const SHARE_DURATION_OPTIONS_MS = [
  0,
  60 * 60 * 1000,
  3 * 60 * 60 * 1000,
  8 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

/** Default "share for" choice (1 hour). */
export const DEFAULT_SHARE_DURATION_MS = 60 * 60 * 1000;

export type SharingStatus = "active" | "inactive";

/** A simple latitude/longitude pair. */
export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A public presence record as broadcast to every connected client.
 * Contains only the masked (randomized) center, never the exact location.
 */
export interface PresenceRecord {
  /** Anonymous, non-identifying public id assigned by the server. */
  publicId: string;
  /** Randomized public center latitude (masked). */
  lat: number;
  /** Randomized public center longitude (masked). */
  lng: number;
  /** Always 200 m. */
  radiusMeters: number;
  /** Epoch ms of the last update. */
  updatedAt: number;
  /** Epoch ms when this record should be considered stale/removed. */
  expiresAt: number;
  status: SharingStatus;
}

/** Payload a client sends to publish/update its masked public location. */
export interface LocationUpdatePayload {
  /** Randomized public center latitude (already masked on the client). */
  lat: number;
  /** Randomized public center longitude (already masked on the client). */
  lng: number;
  /**
   * Optional: keep this circle visible for this many ms from now even if no
   * further updates arrive (phone locked, app closed). Omitted or 0 = live
   * mode. The server caps it at SHARE_MAX_DURATION_MS.
   */
  holdMs?: number;
}

/* ----------------------------- Socket events ----------------------------- */

// Note: the socket connection is now authenticated (a JWT is passed in the
// handshake `auth.token`). The server knows which user owns a connection, but
// the `publicId` below stays a random per-connection id and is NEVER derived
// from the user's identity — other clients can never tell who is where.

import type { ReportDTO } from "./dto";

/** Events emitted by the server to clients. */
export interface ServerToClientEvents {
  /** Sent once on connect: the connecting client's assigned public id. */
  "presence:self": (data: { publicId: string }) => void;
  /** Sent once on connect: all currently active public presence records. */
  "presence:init": (records: PresenceRecord[]) => void;
  /** A presence record was created or updated. */
  "presence:upsert": (record: PresenceRecord) => void;
  /** A presence record was removed (stopped sharing / signed out / expired). */
  "presence:remove": (data: { publicId: string }) => void;
  /**
   * Sent only to the owner, right after connecting, when the server still
   * shows a circle they started earlier (page reload, app reopened, new tab).
   * Lets the client restore its "Sharing" state so the user can see and stop
   * it. `holdRemainingMs` is 0 for live mode.
   */
  "presence:resume": (data: {
    publicId: string;
    lat: number;
    lng: number;
    holdRemainingMs: number;
  }) => void;
  /**
   * Sent only to the owner's own sockets: which publicId is this user's circle
   * (whichever of their sessions is sending it), or null when they have none.
   * Lets every tab/device of the user draw it as "mine" rather than as someone
   * else's — e.g. right after a page refresh, while the old connection hasn't
   * closed yet and still owns the circle.
   */
  "presence:mine": (data: { publicId: string | null }) => void;
  /** Server rejected the last action (validation / rate limit). */
  "error:notice": (data: { code: string; message: string }) => void;

  /**
   * A new safety report was published. Unlike presence, this carries an EXACT
   * point and the author's display name — a deliberate, user-confirmed publish.
   */
  "report:new": (report: ReportDTO) => void;
  /** A report was removed (deleted by its author or moderated). */
  "report:removed": (data: { id: string }) => void;

  /**
   * A scheduled check-in is now due for the connected user. The client should
   * prompt the user to answer their security question before the deadline.
   * Pushed only to the owning user's sockets.
   */
  "checkin:due": (data: {
    occurrenceId: string;
    planId: string;
    question: string;
    deadlineAt: number;
  }) => void;
  /**
   * Someone this user is an emergency contact for missed a check-in. Pushed
   * only to the contact's own sockets (also sent as a push notification).
   */
  "alert:new": (data: { alertId: string; ownerDisplayName: string }) => void;
  /** A contact request was received, accepted or removed: refresh contacts. */
  "contacts:changed": () => void;
  /** Someone sent/accepted/removed a friend request involving me. */
  "friends:changed": () => void;
}

/** Events emitted by clients to the server. */
export interface ClientToServerEvents {
  /** Publish or update the masked public location. */
  "location:update": (payload: LocationUpdatePayload) => void;
  /** Stop sharing immediately; removes the public circle everywhere. */
  "location:stop": () => void;
}
