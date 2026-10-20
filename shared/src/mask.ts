import { LatLng, MASK_RADIUS_METERS } from "./types";

const EARTH_METERS_PER_DEGREE_LAT = 111320;

/**
 * Produce a privacy-preserving public location.
 *
 * The returned point is selected uniformly *by area* within a circle of
 * `maxMeters` (default 50 m) around the exact location:
 *
 *   - random angle in [0, 2pi)
 *   - random radius = maxMeters * sqrt(U), U ~ Uniform(0, 1)
 *
 * Using sqrt(U) avoids clustering points near the center, which a naive
 * uniform radius would cause.
 *
 * The offset is converted into a geographically correct lat/lng delta (the
 * longitude delta is scaled by cos(latitude)) rather than adding arbitrary
 * degree values.
 *
 * IMPORTANT: this must be called on the client/device. Only its result is
 * ever transmitted; the exact `lat`/`lng` arguments must never leave the
 * device.
 *
 * @param random Optional RNG (defaults to Math.random). Injectable for tests.
 */
export function maskLocation(
  lat: number,
  lng: number,
  maxMeters: number = MASK_RADIUS_METERS,
  random: () => number = Math.random
): LatLng {
  const distance = maxMeters * Math.sqrt(random());
  const theta = random() * 2 * Math.PI;

  const offsetNorthMeters = distance * Math.cos(theta);
  const offsetEastMeters = distance * Math.sin(theta);

  const dLat = offsetNorthMeters / EARTH_METERS_PER_DEGREE_LAT;
  const metersPerDegreeLng =
    EARTH_METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
  // Guard against division by ~0 near the poles.
  const dLng =
    metersPerDegreeLng > 1e-9 ? offsetEastMeters / metersPerDegreeLng : 0;

  return { lat: lat + dLat, lng: lng + dLng };
}

/** Great-circle distance in metres between two points (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
