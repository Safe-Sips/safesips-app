import { useState } from "react";
import { Link } from "react-router-dom";
import { EMERGENCY_NUMBER } from "@safesips/shared";
import NotificationsCard from "../components/NotificationsCard";
import { timeAgo } from "../format";
import { useAlerts } from "../hooks/useAlerts";

/** Alerts I received because someone I protect missed a check-in. */
export default function AlertsPage() {
  const { alerts, acknowledge } = useAlerts();
  const [busyId, setBusyId] = useState<string | null>(null);

  return (
    <div className="page alerts-page">
      <div className="page-head">
        <h1>Alerts</h1>
      </div>
      <p className="muted">
        When someone who added you as their emergency contact misses a check-in,
        you're alerted here. Try to reach them, and let the others know you're on
        it.
      </p>

      <NotificationsCard why="Get alerted the moment someone you protect misses a check-in, even with SafeSips closed." />

      {alerts.length === 0 ? (
        <div className="state-card">
          <p className="state-title">No alerts</p>
          <p className="muted">
            Nobody you protect has missed a check-in. To be someone's emergency
            contact, give them your SafeSips code from the Check-ins page.
          </p>
        </div>
      ) : (
        <ul className="alert-list">
          {alerts.map((a) => (
            <li key={a.id} className={`alert-item${a.acknowledgedAt ? "" : " is-new"}`}>
              <p className="alert-title">
                <strong>{a.ownerDisplayName}</strong> missed a safety check-in
                {a.planLabel ? ` ("${a.planLabel}")` : ""}
              </p>
              <p className="muted alert-meta">{timeAgo(a.createdAt)}</p>
              {a.othersOnIt.length > 0 && (
                <p className="hint">{a.othersOnIt.join(", ")} {a.othersOnIt.length === 1 ? "is" : "are"} also checking on them.</p>
              )}
              <div className="data-actions">
                {a.acknowledgedAt ? (
                  <span className="pill pill-active">You're checking on them</span>
                ) : (
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={busyId === a.id}
                    onClick={async () => {
                      setBusyId(a.id);
                      try {
                        await acknowledge(a.id);
                      } finally {
                        setBusyId(null);
                      }
                    }}
                  >
                    I'm checking on them
                  </button>
                )}
                {a.area && (
                  <Link
                    className="btn btn-ghost"
                    to="/"
                    state={{
                      alertArea: { lat: a.area.lat, lng: a.area.lng, name: a.ownerDisplayName, at: a.createdAt },
                    }}
                  >
                    See where they were last sharing
                  </Link>
                )}
              </div>
              <p className="hint">
                {a.area
                  ? "The area is approximate (their privacy circle), not an exact position. "
                  : "They weren't sharing their location at the time. "}
                Can't reach them and worried? Call <strong>{EMERGENCY_NUMBER}</strong>.
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
