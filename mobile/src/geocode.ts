import type { LatLng } from "@safesips/shared";

export interface GeocodeResult extends LatLng {
  displayName: string;
}

const NOMINATIM_USER_AGENT =
  "SafeSips/1.0 (privacy map prototype; contact: support@safesips.app)";

const GEOCODE_TIMEOUT_MS = 10_000;
export const MAX_ADDRESS_LENGTH = 500;

/** Geocode a free-text address via OpenStreetMap Nominatim. */
export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  const query = address.trim();
  if (!query) return null;
  if (query.length > MAX_ADDRESS_LENGTH) {
    throw new Error("Address is too long.");
  }

  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
    encodeURIComponent(query);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GEOCODE_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": NOMINATIM_USER_AGENT,
      },
    });
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) throw new Error(`Geocoding failed (${res.status}).`);

  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  if (!data.length) return null;

  const first = data[0];
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
