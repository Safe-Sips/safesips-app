import { useEffect, useState } from "react";
import type { ConnectionState } from "../hooks/usePresence";

interface ControlsProps {
  connection: ConnectionState;
  sharing: boolean;
  geoStatus: string | null;
  geoError: string | null;
  notice: string | null;
  lastUpdateAt: number | null;
  othersCount: number;
  onShareGps: () => void;
  onUpdate: () => void;
  onStop: () => void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
}

function useIsMobile(breakpoint = 560): boolean {
  const [mobile, setMobile] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia(`(max-width: ${breakpoint}px)`).matches
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [breakpoint]);
  return mobile;
}

function useTimeSince(timestamp: number | null): string {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [timestamp]);

  if (timestamp == null) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s ago`;
}

export default function Controls({
  connection,
  sharing,
  geoStatus,
  geoError,
  notice,
  lastUpdateAt,
  othersCount,
  onShareGps,
  onUpdate,
  onStop,
  onOpenPrivacy,
  onOpenTerms,
}: ControlsProps) {
  const timeSince = useTimeSince(lastUpdateAt);
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <aside className="panel panel-mobile">
        <div className="panel-mobile-top">
          <span
            className={`status-pill status-${connection}`}
            title={`Connection: ${connection}`}
          >
            {connection === "connected"
              ? "Online"
              : connection === "connecting"
                ? "Connecting…"
                : "Offline"}
          </span>
        </div>

        {!sharing ? (
          <button
            className="btn btn-primary btn-block"
            onClick={onShareGps}
            disabled={connection !== "connected"}
          >
            Share My Location
          </button>
        ) : (
          <div className="panel-mobile-sharing">
            <div className="panel-mobile-sharing-meta">
              <strong>
                <span className="dot-live" /> Sharing
              </strong>
              <span>
                {timeSince} · {othersCount} nearby
              </span>
            </div>
            <div className="panel-mobile-sharing-actions">
              <button className="btn btn-ghost btn-sm" onClick={onUpdate}>
                Update
              </button>
              <button className="btn btn-danger btn-sm" onClick={onStop}>
                Stop
              </button>
            </div>
          </div>
        )}

        {geoStatus && <p className="hint">{geoStatus}</p>}
        {geoError && <p className="error">{geoError}</p>}
        {notice && <p className="error">{notice}</p>}

        <div className="panel-mobile-legal" aria-label="Legal and safety information">
          <p className="legal-emergency">
            SafeSips is <strong>not</strong> an emergency service. Call{" "}
            <strong>911</strong> (or your local emergency number) in an emergency.
          </p>
          <p className="legal-links">
            <button type="button" className="legal-link" onClick={onOpenPrivacy}>
              Privacy Policy
            </button>
            <span aria-hidden> · </span>
            <button type="button" className="legal-link" onClick={onOpenTerms}>
              Terms of Service
            </button>
          </p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel">
      <header className="panel-header">
        <div className="brand">
          <div>
            <h1>SafeSips</h1>
            <p className="tagline">Live safety map</p>
          </div>
        </div>
        <span
          className={`status-pill status-${connection}`}
          title={`Connection: ${connection}`}
        >
          {connection === "connected"
            ? "Online"
            : connection === "connecting"
              ? "Connecting…"
              : "Offline"}
        </span>
      </header>

      <button
        className="btn btn-primary btn-block"
        onClick={onShareGps}
        disabled={connection !== "connected"}
      >
        Share My Location
      </button>

      {geoStatus && <p className="hint">{geoStatus}</p>}
      {geoError && <p className="error">{geoError}</p>}
      {notice && <p className="error">{notice}</p>}

      <div className={`sharing-card ${sharing ? "is-sharing" : ""}`}>
        <div className="sharing-row">
          <span className="sharing-label">Sharing status</span>
          <span className="sharing-value">
            {sharing ? (
              <>
                <span className="dot-live" /> Sharing
              </>
            ) : (
              "Not sharing"
            )}
          </span>
        </div>
        <div className="sharing-row">
          <span className="sharing-label">Last update</span>
          <span className="sharing-value">{timeSince}</span>
        </div>
        <div className="sharing-row">
          <span className="sharing-label">Others sharing</span>
          <span className="sharing-value">{othersCount}</span>
        </div>

        {sharing && (
          <div className="sharing-actions">
            <button className="btn btn-ghost" onClick={onUpdate}>
              Update
            </button>
            <button className="btn btn-danger" onClick={onStop}>
              Stop sharing
            </button>
          </div>
        )}
        {sharing && (
          <p className="hint">Auto-stops after 24 hours.</p>
        )}
      </div>

      <p className="privacy-note">
        Your precise location stays private. Others see only an approximate
        <strong> 200&nbsp;m</strong> area centered on a randomized point.
      </p>
      <div className="legend">
        <span className="legend-item">
          <span className="legend-swatch swatch-blue" /> Your exact spot (only
          you)
        </span>
        <span className="legend-item">
          <span className="legend-swatch swatch-yellow" /> Public 200&nbsp;m area
        </span>
        <span className="legend-item">
          <span className="legend-swatch swatch-gray" /> Other people sharing
        </span>
      </div>
    </aside>
  );
}
