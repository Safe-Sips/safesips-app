import { FormEvent, useEffect, useState } from "react";
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
  onSubmitAddress: (address: string) => void;
  onUpdate: () => void;
  onStop: () => void;
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
  onSubmitAddress,
  onUpdate,
  onStop,
}: ControlsProps) {
  const [address, setAddress] = useState("");
  const timeSince = useTimeSince(lastUpdateAt);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmitAddress(address);
  };

  return (
    <aside className="panel">
      <header className="panel-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
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

      <form className="address-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Enter your address"
          aria-label="Enter your address"
          autoComplete="off"
        />
        <button
          className="btn btn-secondary"
          type="submit"
          disabled={connection !== "connected" || !address.trim()}
        >
          Go
        </button>
      </form>

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
          <span className="sharing-label">Others nearby</span>
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
      </div>
    </aside>
  );
}
