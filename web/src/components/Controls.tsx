import { useEffect, useState } from "react";
import { SHARE_DURATION_OPTIONS_MS } from "@safesips/shared";
import { EMERGENCY_NUMBER } from "../content/firstAid";
import type { ConnectionState } from "../hooks/usePresence";

interface ControlsProps {
  connection: ConnectionState;
  sharing: boolean;
  geoStatus: string | null;
  geoError: string | null;
  notice: string | null;
  lastUpdateAt: number | null;
  /** Epoch ms when a timed share ends; null for live mode / not sharing. */
  sharedUntil: number | null;
  /** Selected "share for" duration; 0 = only while the app is open. */
  durationMs: number;
  onDurationChange: (ms: number) => void;
  othersCount: number;
  onShareGps: () => void;
  onUpdate: () => void;
  onStop: () => void;
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
  /** Reopens the "how the map works" explainer. */
  onOpenHowItWorks: () => void;
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

function durationLabel(ms: number): string {
  if (ms <= 0) return "While the app is open";
  const hours = ms / (60 * 60 * 1000);
  return hours === 1 ? "1 hour" : `${hours} hours`;
}

function clockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function DurationPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (ms: number) => void;
}) {
  const options: number[] = [...SHARE_DURATION_OPTIONS_MS];
  if (!options.includes(value)) options.push(value);
  return (
    <label className="field share-duration">
      <span>Share for</span>
      <select
        value={value}
        onChange={(e) => onChange(Number.parseInt(e.target.value, 10))}
      >
        {options.map((ms) => (
          <option key={ms} value={ms}>
            {durationLabel(ms)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Explains why sharing is unavailable and what happens to an active share. */
function ConnectionNotice({
  connection,
  sharing,
}: {
  connection: ConnectionState;
  sharing: boolean;
}) {
  if (connection === "connected") return null;
  if (connection === "connecting") {
    return <p className="hint">Connecting to SafeSips…</p>;
  }
  return (
    <p className="error">
      Can't reach SafeSips. Check your connection — we'll reconnect
      automatically.
      {sharing &&
        " Meanwhile, others still see your last circle for a few minutes, or until your sharing time ends."}
    </p>
  );
}

function sharingHint(sharedUntil: number | null): string {
  const follows = "Your circle follows you while SafeSips is open.";
  return sharedUntil
    ? `${follows} If you lock your phone or close the app, it stays where you last were until ${clockTime(sharedUntil)}. Tap Stop to end it sooner.`
    : `${follows} It disappears a few minutes after you leave the app, and stops after 24 hours at most.`;
}

export default function Controls({
  connection,
  sharing,
  geoStatus,
  geoError,
  notice,
  lastUpdateAt,
  sharedUntil,
  durationMs,
  onDurationChange,
  othersCount,
  onShareGps,
  onUpdate,
  onStop,
  onOpenPrivacy,
  onOpenTerms,
  onOpenHowItWorks,
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
            role="status"
          >
            {connection === "connected"
              ? "Online"
              : connection === "connecting"
                ? "Connecting…"
                : "Offline"}
          </span>
        </div>

        <DurationPicker value={durationMs} onChange={onDurationChange} />

        {!sharing ? (
          <button
            className="btn btn-primary btn-block"
            onClick={onShareGps}
            disabled={connection !== "connected"}
          >
            Share my location
          </button>
        ) : (
          <div className="panel-mobile-sharing">
            <div className="panel-mobile-sharing-meta">
              <strong>
                <span className="dot-live" /> Sharing
              </strong>
              <span>
                {sharedUntil ? `until ${clockTime(sharedUntil)}` : timeSince} ·{" "}
                {othersCount === 1 ? "1 other sharing" : `${othersCount} others sharing`}
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

        {sharing && <p className="hint">{sharingHint(sharedUntil)}</p>}
        {geoStatus && <p className="hint">{geoStatus}</p>}
        {geoError && <p className="error">{geoError}</p>}
        <ConnectionNotice connection={connection} sharing={sharing} />
        {notice && <p className="error">{notice}</p>}

        <div className="panel-mobile-legal" aria-label="Legal and safety information">
          <p className="legal-emergency">
            SafeSips is <strong>not</strong> an emergency service. In an emergency,
            call <strong>{EMERGENCY_NUMBER}</strong> or your local emergency number.
          </p>
          <p className="legal-links">
            <button type="button" className="legal-link" onClick={onOpenHowItWorks}>
              How it works
            </button>
            <span aria-hidden> · </span>
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
          role="status"
        >
          {connection === "connected"
            ? "Online"
            : connection === "connecting"
              ? "Connecting…"
              : "Offline"}
        </span>
      </header>

      <DurationPicker value={durationMs} onChange={onDurationChange} />

      {/* While sharing, Update/Stop below take over (pressing Share again
          would re-mask the circle for no reason). */}
      {!sharing && (
        <button
          className="btn btn-primary btn-block"
          onClick={onShareGps}
          disabled={connection !== "connected"}
        >
          Share my location
        </button>
      )}

      {geoStatus && <p className="hint">{geoStatus}</p>}
      {geoError && <p className="error">{geoError}</p>}
      <ConnectionNotice connection={connection} sharing={sharing} />
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
        {sharing && sharedUntil && (
          <div className="sharing-row">
            <span className="sharing-label">Sharing until</span>
            <span className="sharing-value">{clockTime(sharedUntil)}</span>
          </div>
        )}
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
        {sharing && <p className="hint">{sharingHint(sharedUntil)}</p>}
      </div>

      <p className="privacy-note">
        Your exact location stays on your device. Others only see an approximate
        <strong> 200&nbsp;m</strong> area around a random point near you.
      </p>
      <div className="legend">
        <span className="legend-item">
          <span className="legend-swatch swatch-blue" /> Your exact spot (only you
          see it)
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
