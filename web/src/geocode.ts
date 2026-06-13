import type { LatLng } from "@safesips/shared";

export interface GeocodeResult extends LatLng {
  displayName: string;
}

export type AddressSuggestion = GeocodeResult;

/** Nominatim asks consumers to identify themselves and keep volume low. */
const NOMINATIM_USER_AGENT =
  "SafeSips/1.0 (privacy-preserving location sharing; contact: support@safesips.app)";

const GEOCODE_TIMEOUT_MS = 10_000;
export const MAX_ADDRESS_LENGTH = 500;

type NominatimAddress = Partial<Record<string, string>>;

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: NominatimAddress;
}

/** Autocomplete label: place name, street, and city only. */
export function formatShortAddressLabel(hit: NominatimHit): string {
  const addr = hit.address ?? {};

  const placeFromAddress = [
    "amenity",
    "shop",
    "tourism",
    "leisure",
    "building",
    "historic",
    "office",
    "craft",
    "healthcare",
    "place_of_worship",
    "railway",
    "aeroway",
    "man_made",
  ]
    .map((key) => addr[key]?.trim())
    .find(Boolean);

  const place = hit.name?.trim() || placeFromAddress;

  const street =
    addr.road?.trim() ||
    addr.pedestrian?.trim() ||
    addr.footway?.trim() ||
    addr.street?.trim() ||
    addr.residential?.trim() ||
    addr.path?.trim();

  const city =
    addr.city?.trim() ||
    addr.town?.trim() ||
    addr.village?.trim() ||
    addr.municipality?.trim() ||
    addr.city_district?.trim();

  const parts: string[] = [];
  const add = (part: string | undefined) => {
    if (!part) return;
    if (parts.some((existing) => existing.toLowerCase() === part.toLowerCase())) {
      return;
    }
    parts.push(part);
  };

  add(place);
  add(street);
  add(city);

  if (parts.length > 0) return parts.join(", ");

  return hit.display_name
    .split(",")
    .slice(0, 3)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join(", ");
}

/**
 * Geocode a free-text address using OpenStreetMap Nominatim.
 * Returns the best match, or null when nothing is found.
 */
export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  const query = address.trim();
  if (!query) return null;
  if (query.length > MAX_ADDRESS_LENGTH) {
    throw new Error("Address is too long.");
  }

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": NOMINATIM_USER_AGENT,
    },
    signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status}).`);
  }

  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;

  if (!data.length) return null;

  const [first] = data;
  const lat = Number.parseFloat(first.lat);
  const lng = Number.parseFloat(first.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error("Geocoding returned invalid coordinates.");
  }

  return {
    lat,
    lng,
    displayName: first.display_name,
  };
}

function parseNominatimHit(
  hit: NominatimHit,
  shortLabel = false
): GeocodeResult | null {
  const lat = Number.parseFloat(hit.lat);
  const lng = Number.parseFloat(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    displayName: shortLabel ? formatShortAddressLabel(hit) : hit.display_name,
  };
}

/**
 * Return address suggestions for autocomplete (OpenStreetMap Nominatim).
 * Call sparingly — debounce input and respect Nominatim's 1 req/s guideline.
 */
export async function searchAddressSuggestions(
  query: string,
  limit = 5,
  signal?: AbortSignal
): Promise<AddressSuggestion[]> {
  const trimmed = query.trim();
  if (trimmed.length < 3) return [];
  if (trimmed.length > MAX_ADDRESS_LENGTH) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", trimmed);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 8)));
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": NOMINATIM_USER_AGENT,
    },
    signal: signal ?? AbortSignal.timeout(GEOCODE_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status}).`);
  }

  const data = (await res.json()) as NominatimHit[];

  return data
    .map((hit) => parseNominatimHit(hit, true))
    .filter((item): item is GeocodeResult => item !== null);
}
