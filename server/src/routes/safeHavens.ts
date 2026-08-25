import { Router } from "express";
import { z } from "zod";
import type { SafeHavenDTO, SafeHavenKind } from "@safesips/shared";
import { asyncHandler, parseQuery } from "../http.js";
import { requireAuth } from "../auth/middleware.js";

export const safeHavensRouter = Router();
safeHavensRouter.use(requireAuth);

/** Public Overpass mirrors — cloud hosts are often rate-limited on the primary. */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];
const USER_AGENT =
  "SafeSips/1.0 (privacy-preserving safety map; contact: support@safesips.app)";
const CACHE_TTL_MS = 5 * 60_000;
const MAX_RESULTS = 30;
const DEFAULT_RADIUS = 1500;
const MAX_RADIUS = 5000;
const OVERPASS_TIMEOUT_MS = 18_000;

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
    `[out:json][timeout:15];` +
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
  // Prefer known amenity kinds, then nearer places.
  havens.sort((a, b) => {
    const ak = a.kind === "other" ? 1 : 0;
    const bk = b.kind === "other" ? 1 : 0;
    if (ak !== bk) return ak - bk;
    return a.distanceMeters - b.distanceMeters;
  });
  return havens.slice(0, MAX_RESULTS);
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

async function fetchHavens(
  lat: number,
  lng: number,
  radius: number
): Promise<SafeHavenDTO[]> {
  const ql = buildOverpassQl(lat, lng, radius);
  const errors: string[] = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const elements = await fetchFromEndpoint(endpoint, ql);
      return parseOverpassElements(elements, lat, lng);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(msg);
    }
  }

  throw new Error(errors.join("; ") || "overpass unavailable");
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
      console.error("Safe havens Overpass failed:", err);
      // Never block the unsafe-report flow on Overpass being down.
      res.json({
        havens: hit?.data ?? [],
        error: "Couldn't load nearby help right now. In an emergency call 112.",
        emergencyNumber: "112",
      });
    }
  })
);
