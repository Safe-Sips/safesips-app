import { useEffect, useState } from "react";
import type { LatLng, SafeHavenDTO, SafeHavenKind } from "@safesips/shared";
import { api } from "../api";

const KIND_LABEL: Record<SafeHavenKind, string> = {
  police: "🚓 Police",
  hospital: "🏥 Hospital",
  fire_station: "🚒 Fire station",
  fuel: "⛽ Fuel station",
  pharmacy: "💊 Pharmacy",
  other: "🕛 Open 24/7",
};

interface SafeHavenPanelProps {
  point: LatLng;
  onClose: () => void;
  onLoaded?: (havens: SafeHavenDTO[]) => void;
}

export default function SafeHavenPanel({
  point,
  onClose,
  onLoaded,
}: SafeHavenPanelProps) {
  const [havens, setHavens] = useState<SafeHavenDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setHavens(null);
    setError(null);
    api
      .safeHavens(point.lat, point.lng)
      .then((res) => {
        if (!active) return;
        setHavens(res.havens);
        onLoaded?.(res.havens);
        if (res.error) setError(res.error);
      })
      .catch(() => {
        if (active) setError("Couldn't load nearby help. In an emergency call 112.");
      });
    return () => {
      active = false;
    };
  }, [point.lat, point.lng, onLoaded]);

  return (
    <aside className="haven-panel">
      <div className="haven-panel-head">
        <h3>Nearby help &amp; safe havens</h3>
        <button className="panel-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <a className="emergency-call sm" href="tel:112">
        🚨 Call 112
      </a>

      {error && <p className="hint">{error}</p>}
      {!havens && !error && <p className="muted">Finding the closest help…</p>}
      {havens && havens.length === 0 && !error && (
        <p className="muted">
          No places found nearby. Head toward a busy, well-lit area and call 112
          if you need help.
        </p>
      )}

      <ul className="haven-list">
        {havens?.map((h) => (
          <li key={h.id} className="haven-row">
            <div className="haven-info">
              <span className="haven-kind">{KIND_LABEL[h.kind]}</span>
              <span className="haven-name">{h.name ?? "Unnamed"}</span>
              <span className="muted">
                {h.distanceMeters} m{h.isOpen24_7 ? " · open 24/7" : ""}
              </span>
            </div>
            <div className="haven-links">
              {h.phone && (
                <a className="btn btn-ghost btn-sm" href={`tel:${h.phone}`}>
                  Call
                </a>
              )}
              <a
                className="btn btn-secondary btn-sm"
                href={`https://www.openstreetmap.org/directions?from=&to=${h.lat},${h.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Directions
              </a>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
