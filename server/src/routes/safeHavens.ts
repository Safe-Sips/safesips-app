import dns from "node:dns";
import { Router } from "express";
import { z } from "zod";
import type { SafeHavenDTO, SafeHavenKind } from "@safesips/shared";
import { asyncHandler, parseQuery } from "../http.js";
import { requireAuth } from "../auth/middleware.js";

// Render and other cloud hosts often have broken/slow IPv6; undici then
// surfaces a bare "fetch failed" with no HTTP status. Prefer IPv4.
dns.setDefaultResultOrder("ipv4first");

export const safeHavensRouter = Router();
safeHavensRouter.use(requireAuth);

/**
 * Overpass mirrors — often unreachable from Render (long `fetch failed`).
 * Kept as a short local/dev last resort only.
 */
const OVERPASS_ENDPOINTS = [
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
const PHOTON_SEARCH = "https://photon.komoot.io/api/";

const USER_AGENT =
  "SafeSips/1.0 (privacy-preserving safety map; contact: support@safesips.app)";
const CACHE_TTL_MS = 5 * 60_000;
const MAX_RESULTS = 30;
const DEFAULT_RADIUS = 1500;
const MAX_RADIUS = 5000;
/** Photon / Nominatim — keep wall-clock small on the fast path. */
const FAST_TIMEOUT_MS = 4_000;
/** Overpass last-resort: fail fast; no retries. */
const OVERPASS_TIMEOUT_MS = 2_500;
const OVERPASS_MAX_MIRRORS = 2;
/** Nominatim usage policy: max 1 request/second. */
const NOMINATIM_GAP_MS = 1_100;

/**
 * Overpass is unreliable from Render (and often production). Prefer Photon /
 * Nominatim unless explicitly forced back on.
 */
function shouldSkipOverpass(): boolean {
  if (process.env.SAFE_HAVENS_SKIP_OVERPASS === "0") return false;
  if (process.env.SAFE_HAVENS_SKIP_OVERPASS === "1") return true;
  return Boolean(process.env.RENDER) || process.env.NODE_ENV === "production";
}

const AMENITY_KINDS: SafeHavenKind[] = [
  "police",
  "hospital",
  "fire_station",
  "fuel",
  "pharmacy",
];

interface CacheEntry {
  at: number;
  data: SafeHavenDTO[];
}
const cache = new Map<string, CacheEntry>();

const query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(100).max(MAX_RADIUS).optional(),
});

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function amenityToKind(amenity: string | undefined): SafeHavenKind {
  switch (amenity) {
    case "police":
    case "hospital":
    case "fire_station":
    case "fuel":
    case "pharmacy":
      return amenity;
    default:
      return "other";
  }
}

/** Flatten undici's nested `cause` so Render logs show DNS/TLS/reset reasons. */
function formatFetchError(err: unknown, label: string): string {
  const parts: string[] = [label];
  let cur: unknown = err;
  let depth = 0;
  while (cur && depth < 5) {
    if (cur instanceof Error) {
      parts.push(cur.message);
      const code = (cur as NodeJS.ErrnoException).code;
      if (code) parts.push(`code=${code}`);
      cur = (cur as Error & { cause?: unknown }).cause;
    } else {
      parts.push(String(cur));
      break;
    }
    depth += 1;
  }
  return parts.join(" | ");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function buildOverpassQl(lat: number, lng: number, radius: number): string {
  // nwr = nodes + ways + relations (hospitals/police are often areas, not nodes).
  // `out center` gives coordinates for ways/relations.
  return (
    `[out:json][timeout:2];` +
    `(` +
    `nwr["amenity"~"^(police|hospital|fire_station|fuel|pharmacy)$"](around:${radius},${lat},${lng});` +
    `node["opening_hours"="24/7"](around:${radius},${lat},${lng});` +
    `);` +
    `out center ${MAX_RESULTS * 4};`
  );
}

function parseOverpassElements(
  elements: OverpassElement[],
  lat: number,
  lng: number
): SafeHavenDTO[] {
  const seen = new Set<string>();
  const havens: SafeHavenDTO[] = [];
  for (const el of elements) {
    const elat = el.lat ?? el.center?.lat;
    const elng = el.lon ?? el.center?.lon;
    if (elat == null || elng == null) continue;
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = el.tags ?? {};
    const openingHours = tags.opening_hours ?? null;
    const kind = amenityToKind(tags.amenity);
    // Drop 24/7 noise that isn't a useful safe haven (toilets, recycling, etc.).
    if (kind === "other") {
      const junk = tags.amenity;
      if (
        !tags.name ||
        junk === "toilets" ||
        junk === "recycling" ||
        junk === "waste_basket" ||
        junk === "bench" ||
        junk === "atm"
      ) {
        continue;
      }
    }
    havens.push({
      id,
      kind,
      name: tags.name ?? null,
      lat: elat,
      lng: elng,
      distanceMeters: Math.round(haversine(lat, lng, elat, elng)),
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      openingHours,
      isOpen24_7: openingHours === "24/7",
    });
  }
  return rankAndCap(havens);
}

function rankAndCap(havens: SafeHavenDTO[]): SafeHavenDTO[] {
  havens.sort((a, b) => {
    const ak = a.kind === "other" ? 1 : 0;
    const bk = b.kind === "other" ? 1 : 0;
    if (ak !== bk) return ak - bk;
    return a.distanceMeters - b.distanceMeters;
  });
  return havens.slice(0, MAX_RESULTS);
}

function mergeHavens(batches: SafeHavenDTO[][]): SafeHavenDTO[] {
  const seen = new Set<string>();
  const out: SafeHavenDTO[] = [];
  for (const batch of batches) {
    for (const h of batch) {
      if (seen.has(h.id)) continue;
      seen.add(h.id);
      out.push(h);
    }
  }
  return rankAndCap(out);
}

async function fetchFromEndpoint(
  endpoint: string,
  ql: string
): Promise<OverpassElement[]> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: ql }),
    signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`overpass ${res.status} from ${endpoint}`);
  }
  // Some mirrors return XML/HTML error bodies with a misleading status.
  if (!text || text.trimStart().startsWith("<")) {
    throw new Error(`overpass non-json from ${endpoint}`);
  }
  let json: { elements?: OverpassElement[] };
  try {
    json = JSON.parse(text) as { elements?: OverpassElement[] };
  } catch {
    throw new Error(`overpass bad-json from ${endpoint}`);
  }
  return json.elements ?? [];
}

/** Short last-resort Overpass: few mirrors, no retries. */
async function fetchOverpass(
  lat: number,
  lng: number,
  radius: number
): Promise<SafeHavenDTO[]> {
  const ql = buildOverpassQl(lat, lng, radius);
  const errors: string[] = [];
  const mirrors = OVERPASS_ENDPOINTS.slice(0, OVERPASS_MAX_MIRRORS);

  for (const endpoint of mirrors) {
    try {
      const elements = await fetchFromEndpoint(endpoint, ql);
      // eslint-disable-next-line no-console
      console.info(`Safe havens: Overpass OK via ${endpoint}`);
      return parseOverpassElements(elements, lat, lng);
    } catch (err) {
      errors.push(formatFetchError(err, endpoint));
    }
  }

  throw new Error(errors.join("; ") || "overpass unavailable");
}

/** Degrees delta for a meter radius (approx). */
function radiusToViewbox(
  lat: number,
  lng: number,
  radius: number
): { left: number; top: number; right: number; bottom: number } {
  const dLat = radius / 111_320;
  const cos = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const dLng = radius / (111_320 * cos);
  return {
    left: lng - dLng,
    top: lat + dLat,
    right: lng + dLng,
    bottom: lat - dLat,
  };
}

interface NominatimResult {
  place_id: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  class?: string;
  type?: string;
}

async function fetchNominatimAmenity(
  kind: SafeHavenKind,
  lat: number,
  lng: number,
  radius: number
): Promise<SafeHavenDTO[]> {
  const box = radiusToViewbox(lat, lng, radius);
  const url = new URL(NOMINATIM_SEARCH);
  url.searchParams.set("amenity", kind);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "8");
  url.searchParams.set(
    "viewbox",
    `${box.left},${box.top},${box.right},${box.bottom}`
  );
  url.searchParams.set("bounded", "1");
  url.searchParams.set("addressdetails", "0");

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FAST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`nominatim ${res.status} for ${kind}`);
  }
  const json = (await res.json()) as NominatimResult[];
  if (!Array.isArray(json)) return [];

  const havens: SafeHavenDTO[] = [];
  for (const item of json) {
    const elat = Number(item.lat);
    const elng = Number(item.lon);
    if (!Number.isFinite(elat) || !Number.isFinite(elng)) continue;
    const dist = Math.round(haversine(lat, lng, elat, elng));
    if (dist > radius) continue;
    const osmType = item.osm_type ?? "node";
    const osmId = item.osm_id ?? item.place_id;
    havens.push({
      id: `nominatim/${osmType}/${osmId}`,
      kind,
      name: item.name ?? item.display_name?.split(",")[0]?.trim() ?? null,
      lat: elat,
      lng: elng,
      distanceMeters: dist,
      phone: null,
      openingHours: null,
      isOpen24_7: false,
    });
  }
  return havens;
}

async function fetchNominatimFallback(
  lat: number,
  lng: number,
  radius: number
): Promise<SafeHavenDTO[]> {
  const batches: SafeHavenDTO[][] = [];
  const errors: string[] = [];

  for (let i = 0; i < AMENITY_KINDS.length; i++) {
    const kind = AMENITY_KINDS[i]!;
    if (i > 0) await sleep(NOMINATIM_GAP_MS);
    try {
      batches.push(await fetchNominatimAmenity(kind, lat, lng, radius));
    } catch (err) {
      errors.push(formatFetchError(err, `nominatim/${kind}`));
    }
  }

  const merged = mergeHavens(batches);
  if (merged.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; ") || "nominatim unavailable");
  }
  // eslint-disable-next-line no-console
  console.info(
    `Safe havens: Nominatim returned ${merged.length} (errors=${errors.length})`
  );
  return merged;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    osm_type?: string;
    osm_id?: number;
    name?: string;
    osm_key?: string;
    osm_value?: string;
  };
}

async function fetchPhotonAmenity(
  kind: SafeHavenKind,
  lat: number,
  lng: number,
  radius: number
): Promise<SafeHavenDTO[]> {
  const url = new URL(PHOTON_SEARCH);
  url.searchParams.set("q", kind.replace("_", " "));
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("limit", "8");
  url.searchParams.set("osm_tag", `amenity:${kind}`);

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(FAST_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`photon ${res.status} for ${kind}`);
  }
  const json = (await res.json()) as { features?: PhotonFeature[] };
  const features = json.features ?? [];
  const havens: SafeHavenDTO[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) continue;
    const [elng, elat] = coords;
    if (elat == null || elng == null) continue;
    const dist = Math.round(haversine(lat, lng, elat, elng));
    if (dist > radius) continue;
    const props = f.properties ?? {};
    const osmType = (props.osm_type ?? "N").toLowerCase();
    const typeName =
      osmType === "w" || osmType === "way"
        ? "way"
        : osmType === "r" || osmType === "relation"
          ? "relation"
          : "node";
    const osmId = props.osm_id ?? Math.round(elat * 1e6 + elng * 1e6);
    havens.push({
      id: `photon/${typeName}/${osmId}`,
      kind,
      name: props.name ?? null,
      lat: elat,
      lng: elng,
      distanceMeters: dist,
      phone: null,
      openingHours: null,
      isOpen24_7: false,
    });
  }
  return havens;
}

/** Photon has no 1 req/s policy — fan out amenity kinds in parallel. */
async function fetchPhotonPrimary(
  lat: number,
  lng: number,
  radius: number
): Promise<SafeHavenDTO[]> {
  const errors: string[] = [];
  const settled = await Promise.all(
    AMENITY_KINDS.map(async (kind) => {
      try {
        return await fetchPhotonAmenity(kind, lat, lng, radius);
      } catch (err) {
        errors.push(formatFetchError(err, `photon/${kind}`));
        return [] as SafeHavenDTO[];
      }
    })
  );

  const merged = mergeHavens(settled);
  if (merged.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; ") || "photon unavailable");
  }
  // eslint-disable-next-line no-console
  console.info(
    `Safe havens: Photon returned ${merged.length} (errors=${errors.length})`
  );
  return merged;
}

/**
 * Fast path: Photon (parallel) → Nominatim (sequential, policy-safe).
 * Overpass only when not skipped (local/dev), with a tiny timeout budget.
 */
async function fetchHavens(
  lat: number,
  lng: number,
  radius: number
): Promise<SafeHavenDTO[]> {
  const errors: string[] = [];

  try {
    const photon = await fetchPhotonPrimary(lat, lng, radius);
    if (photon.length > 0) return photon;
  } catch (err) {
    errors.push(formatFetchError(err, "photon"));
  }

  try {
    const nominatim = await fetchNominatimFallback(lat, lng, radius);
    if (nominatim.length > 0) return nominatim;
  } catch (err) {
    errors.push(formatFetchError(err, "nominatim"));
  }

  if (!shouldSkipOverpass()) {
    try {
      return await fetchOverpass(lat, lng, radius);
    } catch (err) {
      errors.push(formatFetchError(err, "overpass"));
    }
  } else {
    // eslint-disable-next-line no-console
    console.info("Safe havens: skipping Overpass (production/Render)");
  }

  throw new Error(
    errors.join("; ") ||
      "All POI sources unreachable (Photon, Nominatim, Overpass)"
  );
}

safeHavensRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(query, req, res);
    if (!q) return;
    const radius = Math.round(q.radius ?? DEFAULT_RADIUS);
    const key = `${q.lat.toFixed(3)},${q.lng.toFixed(3)},${radius}`;
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) {
      res.json({ havens: hit.data, cached: true });
      return;
    }
    try {
      const data = await fetchHavens(q.lat, q.lng, radius);
      cache.set(key, { at: now, data });
      res.json({ havens: data, cached: false });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        "Safe havens all sources failed:",
        formatFetchError(err, "safe-havens")
      );
      // Never block the unsafe-report flow on POI providers being down.
      res.json({
        havens: hit?.data ?? [],
        error: "Couldn't load nearby help right now. In an emergency call 112.",
        emergencyNumber: "112",
      });
    }
  })
);
