import { LocationUpdatePayload } from "./types";

export interface ValidationResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validate an incoming location update payload.
 *
 * Accepts only a well-formed `{ lat, lng }` with coordinates inside valid
 * Earth ranges. Any extra fields are dropped so that nothing unexpected
 * (e.g. an accidental "exactLat") can be persisted or rebroadcast.
 */
export function validateLocationUpdate(
  payload: unknown
): ValidationResult<LocationUpdatePayload> {
  if (typeof payload !== "object" || payload === null) {
    return { ok: false, error: "Payload must be an object." };
  }

  const { lat, lng } = payload as Record<string, unknown>;

  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return { ok: false, error: "lat and lng must be finite numbers." };
  }
  if (lat < -90 || lat > 90) {
    return { ok: false, error: "lat must be between -90 and 90." };
  }
  if (lng < -180 || lng > 180) {
    return { ok: false, error: "lng must be between -180 and 180." };
  }

  // Re-construct a clean object, discarding any other fields.
  return { ok: true, value: { lat, lng } };
}
