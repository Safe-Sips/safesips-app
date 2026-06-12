import type { LatLng } from "@safesips/shared";

type Position = [number, number]; // [lng, lat] for GeoJSON

export interface CircleFeature {
  type: "Feature";
  properties: { publicId: string };
  geometry: { type: "Polygon"; coordinates: Position[][] };
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: CircleFeature[];
}

const EARTH_METERS_PER_DEGREE_LAT = 111320;

/**
 * Build a GeoJSON polygon approximating a geographic circle of `radiusMeters`
 * around `center`. MapLibre has no native circle-by-meters fill, so we
 * triangulate a ring with `steps` points.
 */
export function circlePolygon(
  center: LatLng,
  radiusMeters: number,
  publicId: string,
  steps = 64
): CircleFeature {
  const coords: Position[] = [];
  const latRad = (center.lat * Math.PI) / 180;
  const metersPerDegreeLng =
    EARTH_METERS_PER_DEGREE_LAT * Math.cos(latRad) || 1e-9;

  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    const dNorth = radiusMeters * Math.cos(angle);
    const dEast = radiusMeters * Math.sin(angle);
    const lat = center.lat + dNorth / EARTH_METERS_PER_DEGREE_LAT;
    const lng = center.lng + dEast / metersPerDegreeLng;
    coords.push([lng, lat]);
  }

  return {
    type: "Feature",
    properties: { publicId },
    geometry: { type: "Polygon", coordinates: [coords] },
  };
}

export function toFeatureCollection(features: CircleFeature[]): FeatureCollection {
  return { type: "FeatureCollection", features };
}
