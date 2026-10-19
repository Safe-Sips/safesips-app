import {
  LatLng,
  PresenceRecord,
  PUBLIC_RADIUS_METERS,
} from "@safesips/shared";

/**
 * In-memory store of public presence records.
 *
 * It intentionally only ever holds the masked (randomized) public center.
 * Exact coordinates are never sent to the server and therefore never stored.
 */
export class PresenceStore {
  private records = new Map<string, PresenceRecord>();

  constructor(private readonly ttlMs: number) {}

  /**
   * Create or update a record from a masked center. Returns the record.
   *
   * Live mode (`holdMs` = 0): the record stays visible for the TTL after this
   * update. "Share for 1 hour" etc.: it stays for exactly `holdMs`, so it
   * survives the phone locking or the app closing and ends on time.
   */
  upsert(
    publicId: string,
    center: LatLng,
    now = Date.now(),
    holdMs = 0
  ): PresenceRecord {
    const record: PresenceRecord = {
      publicId,
      lat: center.lat,
      lng: center.lng,
      radiusMeters: PUBLIC_RADIUS_METERS,
      updatedAt: now,
      expiresAt: now + (holdMs > 0 ? holdMs : this.ttlMs),
      status: "active",
    };
    this.records.set(publicId, record);
    return record;
  }

  remove(publicId: string): boolean {
    return this.records.delete(publicId);
  }

  has(publicId: string): boolean {
    return this.records.has(publicId);
  }

  /** The record for an id if it exists and has not expired yet. */
  get(publicId: string, now = Date.now()): PresenceRecord | undefined {
    const record = this.records.get(publicId);
    return record && record.expiresAt > now ? record : undefined;
  }

  /** All currently non-expired records. */
  active(now = Date.now()): PresenceRecord[] {
    const result: PresenceRecord[] = [];
    for (const record of this.records.values()) {
      if (record.expiresAt > now) result.push(record);
    }
    return result;
  }

  /** Remove and return the ids of records that have expired. */
  sweepExpired(now = Date.now()): string[] {
    const expired: string[] = [];
    for (const [id, record] of this.records.entries()) {
      if (record.expiresAt <= now) {
        this.records.delete(id);
        expired.push(id);
      }
    }
    return expired;
  }

  get size(): number {
    return this.records.size;
  }
}
