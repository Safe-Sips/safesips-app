import { Circle } from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import { PUBLIC_RADIUS_METERS } from "@safesips/shared";

interface PrivacyCircleProps {
  center: LatLngExpression;
  /** Slightly emphasize the current user's own area. */
  isSelf?: boolean;
}

/**
 * The public, privacy-preserving area.
 *
 * Rendered as two stacked geographic circles of exactly 200 m radius:
 *  - a semi-transparent yellow fill with a pulsing solid border
 *  - a dashed ring whose dash offset animates to create a radar "scan"
 *
 * The center is always the randomized point, never the exact location.
 */
export default function PrivacyCircle({ center, isSelf }: PrivacyCircleProps) {
  return (
    <>
      <Circle
        center={center}
        radius={PUBLIC_RADIUS_METERS}
        pathOptions={{
          className: "privacy-circle",
          color: "#ffd400",
          fillColor: "#ffd400",
          fillOpacity: isSelf ? 0.16 : 0.1,
          weight: 2,
        }}
      />
      <Circle
        center={center}
        radius={PUBLIC_RADIUS_METERS}
        pathOptions={{
          className: "radar-sweep",
          color: "#ffd400",
          fill: false,
          weight: 3,
          dashArray: "14 22",
        }}
      />
    </>
  );
}
