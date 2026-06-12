import type { LatLng } from "@safesips/shared";

export interface GeocodeResult extends LatLng {
  displayName: string;
}

/**
 * Geocode a free-text address using the public OpenStreetMap Nominatim
 * service. Returns the best match, or null when nothing is found.
 *
 * Note: Nominatim asks consumers to keep request volume low and identify
 * themselves; this is fine for the prototype scale described in the spec.
 */
export async function geocodeAddress(
  address: string
): Promise<GeocodeResult | null> {
  const query = address.trim();
  if (!query) return null;

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");

  const res = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
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
  return {
    lat: Number.parseFloat(first.lat),
    lng: Number.parseFloat(first.lon),
    displayName: first.display_name,
  };
}
