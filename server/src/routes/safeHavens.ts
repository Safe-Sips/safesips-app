import { Router } from "express";
import { z } from "zod";
import type { SafeHavenDTO, SafeHavenKind } from "@safesips/shared";
import { asyncHandler, parseQuery } from "../http.js";
import { requireAuth } from "../auth/middleware.js";

export const safeHavensRouter = Router();
safeHavensRouter.use(requireAuth);

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const USER_AGENT =
  "SafeSips/1.0 (privacy-preserving safety map; contact: support@safesips.app)";
const CACHE_TTL_MS = 5 * 60_000;
const MAX_RESULTS = 30;
const DEFAULT_RADIUS = 1500;
const MAX_RADIUS = 5000;

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

async function fetchHavens(
  lat: number,
  lng: number,
  radius: number
): Promise<SafeHavenDTO[]> {
  const ql =
    `[out:json][timeout:20];` +
    `(` +
    `node["amenity"~"^(police|hospital|fire_station|fuel|pharmacy)$"](around:${radius},${lat},${lng});` +
    `node["opening_hours"="24/7"](around:${radius},${lat},${lng});` +
    `);` +
    `out body ${MAX_RESULTS * 3};`;

  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
      Accept: "application/json",
    },
    body: new URLSearchParams({ data: ql }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`overpass ${res.status}`);
  const json = (await res.json()) as { elements?: OverpassElement[] };

  const seen = new Set<string>();
  const havens: SafeHavenDTO[] = [];
  for (const el of json.elements ?? []) {
    const elat = el.lat ?? el.center?.lat;
    const elng = el.lon ?? el.center?.lon;
    if (elat == null || elng == null) continue;
    const id = `${el.type}/${el.id}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const tags = el.tags ?? {};
    const openingHours = tags.opening_hours ?? null;
    havens.push({
      id,
      kind: amenityToKind(tags.amenity),
      name: tags.name ?? null,
      lat: elat,
      lng: elng,
      distanceMeters: Math.round(haversine(lat, lng, elat, elng)),
      phone: tags.phone ?? tags["contact:phone"] ?? null,
      openingHours,
      isOpen24_7: openingHours === "24/7",
    });
  }
  havens.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return havens.slice(0, MAX_RESULTS);
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
    } catch {
      // Never block the unsafe-report flow on Overpass being down.
      res.json({
        havens: hit?.data ?? [],
        error: "Couldn't load nearby help right now. In an emergency call 112.",
        emergencyNumber: "112",
      });
    }
  })
);
