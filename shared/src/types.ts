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
  /** A presence record was removed (stopped sharing / disconnected / expired). */
  "presence:remove": (data: { publicId: string }) => void;
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
}

/** Events emitted by clients to the server. */
export interface ClientToServerEvents {
  /** Publish or update the masked public location. */
  "location:update": (payload: LocationUpdatePayload) => void;
  /** Stop sharing immediately; removes the public circle everywhere. */
  "location:stop": () => void;
}
