import type { LatLng } from "@safesips/shared";

export interface GeocodeResult extends LatLng {
  displayName: string;
}

/** Geocode a free-text address via OpenStreetMap Nominatim. */
export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  const query = address.trim();
  if (!query) return null;

  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" +
    encodeURIComponent(query);

  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "SafeSips/1.0 (privacy map prototype)",
    },
  });
  if (!res.ok) throw new Error(`Geocoding failed (${res.status}).`);

  const data = (await res.json()) as Array<{
    lat: string;
    lon: string;
    display_name: string;
  }>;
  if (!data.length) return null;

  const first = data[0];
  return {
    lat: Number.parseFloat(first.lat),
    lng: Number.parseFloat(first.lon),
    displayName: first.display_name,
  };
}
