import { useEffect } from "react";
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLng, PresenceRecord } from "@safesips/shared";
import PrivacyCircle from "./PrivacyCircle";

interface MapViewProps {
  /** Exact location, used ONLY locally for the blue dot + auto-centering. */
  exact: LatLng | null;
  /** This client's masked public center, if sharing. */
  selfPublic: LatLng | null;
  /** Other users' public presence records. */
  others: PresenceRecord[];
}

const DEFAULT_CENTER: [number, number] = [44.4268, 26.1025]; // Bucharest
const DEFAULT_ZOOM = 13;
const FOCUS_ZOOM = 16;

/** Recenters the map whenever the exact location updates. */
function Recenter({ exact }: { exact: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (exact) {
      map.setView([exact.lat, exact.lng], Math.max(map.getZoom(), FOCUS_ZOOM), {
        animate: true,
      });
    }
  }, [exact, map]);
  return null;
}

export default function MapView({ exact, selfPublic, others }: MapViewProps) {
  return (
    <MapContainer
      center={DEFAULT_CENTER}
      zoom={DEFAULT_ZOOM}
      zoomControl={false}
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
        <PrivacyCircle
          key={record.publicId}
          center={[record.lat, record.lng]}
        />
      ))}

      {/* This user's own public privacy circle. */}
      {selfPublic && (
        <PrivacyCircle center={[selfPublic.lat, selfPublic.lng]} isSelf />
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
    </MapContainer>
  );
}
