import { useEffect } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type {
  LatLng,
  PresenceRecord,
  ReportDTO,
  SafeHavenDTO,
  SafeHavenKind,
} from "@safesips/shared";
import PrivacyCircle from "./PrivacyCircle";

interface MapViewProps {
  /** Exact location, used ONLY locally for the blue dot + auto-centering. */
  exact: LatLng | null;
  selfPublic: LatLng | null;
  others: PresenceRecord[];
  reports: ReportDTO[];
  havens: SafeHavenDTO[];
  /** When true, a map click picks a point to report. */
  pickMode: boolean;
  pendingPoint: LatLng | null;
  onPickPoint: (point: LatLng) => void;
  onSelectReport: (report: ReportDTO) => void;
  onBoundsChange: (bounds: L.LatLngBounds) => void;
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

function Recenter({ exact }: { exact: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (exact) {
      map.setView([exact.lat, exact.lng], Math.max(map.getZoom(), FOCUS_ZOOM), {
        animate: true,
      });
    }
  }, [exact?.lat, exact?.lng, map]);
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
  return null;
}

export default function MapView({
  exact,
  selfPublic,
  others,
  reports,
  havens,
  pickMode,
  pendingPoint,
  onPickPoint,
  onSelectReport,
  onBoundsChange,
}: MapViewProps) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      zoomControl={false}
      className={`map-root${pickMode ? " is-picking" : ""}`}
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

      {/* This user's own public privacy circle. */}
      {selfPublic && (
        <PrivacyCircle center={[selfPublic.lat, selfPublic.lng]} isSelf />
      )}

      {/* Safety reports — EXACT, intentionally public points. */}
      {reports.map((r) => (
        <CircleMarker
          key={r.id}
          center={[r.lat, r.lng]}
          radius={9}
          pathOptions={{
            color: "#ffffff",
            weight: 2,
            fillColor: r.safety === "unsafe" ? "#ff4d5e" : "#2ed573",
            fillOpacity: 0.9,
          }}
          eventHandlers={{ click: () => onSelectReport(r) }}
        >
          <Tooltip direction="top" offset={[0, -8]}>
            {r.safety === "unsafe" ? "⚠️ Unsafe" : "✓ Safe"} · {r.voteCount} ▲
          </Tooltip>
        </CircleMarker>
      ))}

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
      <MapEvents
        pickMode={pickMode}
        onPickPoint={onPickPoint}
        onBoundsChange={onBoundsChange}
      />
    </MapContainer>
  );
}
