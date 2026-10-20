import { useEffect, useRef, useState } from "react";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
// Loaded with the (lazy) map chunk instead of on every page.
import "leaflet/dist/leaflet.css";
import {
  PUBLIC_RADIUS_METERS,
  reportOpacity,
  type LatLng,
  type PresenceRecord,
  type ReportDTO,
  type SafeHavenDTO,
  type SafeHavenKind,
} from "@safesips/shared";
import { timeAgo } from "../format";
import PrivacyCircle from "./PrivacyCircle";

/** Someone's last shared (masked) area, opened from a missed-check-in alert. */
export interface AlertArea extends LatLng {
  name: string;
  /** When the alert was raised. */
  at: number;
}

/** A place to recenter the map on. Optional zoom overrides the focus zoom. */
export type FocusPoint = LatLng & { zoom?: number };

interface MapViewProps {
  /** Exact location, used ONLY locally for the blue dot + auto-centering. */
  exact: LatLng | null;
  selfPublic: LatLng | null;
  others: PresenceRecord[];
  /** Reports still on the map (expired ones already filtered out). */
  reports: ReportDTO[];
  /** Clock used to fade reports by age (ticks every few minutes). */
  reportNow: number;
  havens: SafeHavenDTO[];
  /** When true, a map click picks a point to report. */
  pickMode: boolean;
  pendingPoint: LatLng | null;
  /** Recenters the map (on entry, on "use my location", after reporting). */
  focusPoint: FocusPoint | null;
  /** Shown highlighted when opened from an alert. */
  alertArea: AlertArea | null;
  onPickPoint: (point: LatLng) => void;
  onSelectReport: (report: ReportDTO) => void;
  onBoundsChange: (bounds: L.LatLngBounds) => void;
}

/** "updated 3 min ago" for other people's circles. */
function updatedAgo(updatedAt: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - updatedAt) / 60_000);
  if (minutes < 1) return "updated just now";
  if (minutes < 60) return `updated ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `updated ${hours} h ${minutes % 60} min ago`;
}

/** Re-render every 30 s so "updated X min ago" labels stay current. */
function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

/**
 * Self-contained "updated X min ago" label. Owns its own ticking clock so the
 * 30 s refresh re-renders only this tiny span, not the whole map and every
 * marker on it.
 */
function UpdatedAgo({ updatedAt }: { updatedAt: number }) {
  const now = useNow();
  return <>{updatedAgo(updatedAt, now)}</>;
}

/** Honour the OS "reduce motion" setting for Leaflet's JS-driven animations. */
function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

const DEFAULT_CENTER: [number, number] = [44.4268, 26.1025]; // Bucharest
const DEFAULT_ZOOM = 13;
const FOCUS_ZOOM = 16;

const HAVEN_EMOJI: Record<SafeHavenKind, string> = {
  police: "🚓",
  hospital: "🏥",
  fire_station: "🚒",
  fuel: "⛽",
  pharmacy: "💊",
  other: "🕛",
};

function havenIcon(kind: SafeHavenKind): L.DivIcon {
  return L.divIcon({
    html: `<div class="haven-pin">${HAVEN_EMOJI[kind]}</div>`,
    className: "haven-pin-wrap",
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

const PENDING_ICON = L.divIcon({
  html: `<div class="pending-pin">📍</div>`,
  className: "pending-pin-wrap",
  iconSize: [32, 32],
  iconAnchor: [16, 30],
});

/**
 * Centres the map on you once, when sharing starts. It deliberately does not
 * follow later moves: the live circle updates while you walk, and snapping the
 * view back each time would fight you panning around the map.
 */
function Recenter({ exact }: { exact: LatLng | null }) {
  const map = useMap();
  const sharing = exact !== null;
  const exactRef = useRef(exact);
  exactRef.current = exact;
  useEffect(() => {
    const here = exactRef.current;
    if (!sharing || !here) return;
    map.setView([here.lat, here.lng], Math.max(map.getZoom(), FOCUS_ZOOM), {
      animate: !prefersReducedMotion(),
    });
  }, [sharing, map]);
  return null;
}

/** Flies the map to a focus point — used for initial centering on the user,
 *  for "use my location", and to move to a place right after reporting it. */
function FlyTo({ focus }: { focus: FocusPoint | null }) {
  const map = useMap();
  useEffect(() => {
    if (!focus) return;
    const zoom = focus.zoom ?? Math.max(map.getZoom(), FOCUS_ZOOM);
    map.setView([focus.lat, focus.lng], zoom, { animate: !prefersReducedMotion() });
  }, [focus?.lat, focus?.lng, focus?.zoom, map]);
  return null;
}

function MapEvents({
  pickMode,
  onPickPoint,
  onBoundsChange,
}: {
  pickMode: boolean;
  onPickPoint: (p: LatLng) => void;
  onBoundsChange: (b: L.LatLngBounds) => void;
}) {
  const map = useMapEvents({
    click(e) {
      if (pickMode) onPickPoint({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
    moveend() {
      onBoundsChange(map.getBounds());
    },
  });
  // Emit initial bounds once.
  useEffect(() => {
    onBoundsChange(map.getBounds());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // MapContainer applies its `className` prop only at mount, so the pick-mode
  // crosshair class can't be toggled reactively through it. Toggle it directly
  // on the live container element whenever pickMode changes.
  useEffect(() => {
    const el = map.getContainer();
    el.classList.toggle("is-picking", pickMode);
    return () => el.classList.remove("is-picking");
  }, [map, pickMode]);
  return null;
}

export default function MapView({
  exact,
  selfPublic,
  others,
  reports,
  reportNow,
  havens,
  pickMode,
  pendingPoint,
  focusPoint,
  alertArea,
  onPickPoint,
  onSelectReport,
  onBoundsChange,
}: MapViewProps) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      zoomControl={false}
      zoomAnimation={!prefersReducedMotion()}
      fadeAnimation={!prefersReducedMotion()}
      markerZoomAnimation={!prefersReducedMotion()}
      className="map-root"
      preferCanvas={false}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />

      {/* Other users' public privacy circles. */}
      {others.map((record) => (
        <PrivacyCircle key={record.publicId} center={[record.lat, record.lng]} />
      ))}

      {/* Other users' public (masked) location: a light gray dot. */}
      {others.map((record) => (
        <CircleMarker
          key={`${record.publicId}-dot`}
          center={[record.lat, record.lng]}
          radius={7}
          pathOptions={{
            className: "other-dot",
            color: "#ffffff",
            weight: 2,
            fillColor: "#c5c9d4",
            fillOpacity: 1,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            Someone sharing nearby · <UpdatedAgo updatedAt={record.updatedAt} />
          </Tooltip>
        </CircleMarker>
      ))}

      {/* Where someone who missed a check-in was last sharing (their masked
          circle at the time of the alert — never an exact position). */}
      {alertArea && (
        <Circle
          center={[alertArea.lat, alertArea.lng]}
          radius={PUBLIC_RADIUS_METERS}
          pathOptions={{ color: "#ff4d5e", fillColor: "#ff4d5e", fillOpacity: 0.14, weight: 3 }}
        >
          <Tooltip direction="top" permanent>
            {alertArea.name} · last shared area
          </Tooltip>
        </Circle>
      )}

      {/* This user's own public privacy circle. */}
      {selfPublic && (
        <PrivacyCircle center={[selfPublic.lat, selfPublic.lng]} isSelf />
      )}

      {/* Safety reports — EXACT, intentionally public points. They fade
          from full strength to 60% over 48 h, then disappear. */}
      {reports.map((r) => {
        const opacity = reportOpacity(r.createdAt, reportNow);
        return (
          <CircleMarker
            key={r.id}
            center={[r.lat, r.lng]}
            radius={9}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              opacity,
              fillColor: r.safety === "unsafe" ? "#ff4d5e" : "#2ed573",
              fillOpacity: 0.9 * opacity,
            }}
            eventHandlers={{ click: () => onSelectReport(r) }}
          >
            <Tooltip direction="top" offset={[0, -8]}>
              {r.safety === "unsafe" ? "⚠️ Unsafe" : "✓ Safe"} · {r.voteCount} ▲ ·{" "}
              {timeAgo(r.createdAt)}
            </Tooltip>
          </CircleMarker>
        );
      })}

      {/* Nearby safe havens. */}
      {havens.map((h) => (
        <Marker key={h.id} position={[h.lat, h.lng]} icon={havenIcon(h.kind)}>
          <Tooltip direction="top" offset={[0, -12]}>
            {h.name ?? h.kind.replace("_", " ")} · {h.distanceMeters} m
            {h.isOpen24_7 ? " · 24/7" : ""}
          </Tooltip>
        </Marker>
      ))}

      {/* Point the user is about to report. */}
      {pendingPoint && (
        <Marker position={[pendingPoint.lat, pendingPoint.lng]} icon={PENDING_ICON} />
      )}

      {/* This user's exact location: a blue dot, visible ONLY on this device. */}
      {exact && (
        <CircleMarker
          center={[exact.lat, exact.lng]}
          radius={7}
          pathOptions={{
            className: "self-dot",
            color: "#ffffff",
            weight: 2,
            fillColor: "#2f7bff",
            fillOpacity: 1,
          }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            Your exact location (private)
          </Tooltip>
        </CircleMarker>
      )}

      <Recenter exact={exact} />
      <FlyTo focus={focusPoint} />
      <MapEvents
        pickMode={pickMode}
        onPickPoint={onPickPoint}
        onBoundsChange={onBoundsChange}
      />
    </MapContainer>
  );
}
