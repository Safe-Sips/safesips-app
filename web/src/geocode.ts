import type { LatLng } from "@safesips/shared";

export interface GeocodeResult extends LatLng {
  displayName: string;
}

/** Nominatim asks consumers to identify themselves and keep volume low. */
const NOMINATIM_USER_AGENT =
  "SafeSips/1.0 (privacy-preserving location sharing; contact: support@safesips.app)";

const GEOCODE_TIMEOUT_MS = 10_000;
export const MAX_ADDRESS_LENGTH = 500;

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
