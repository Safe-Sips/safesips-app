import { useDialogA11y } from "../hooks/useDialogA11y";

const SEEN_KEY = "safesips.mapIntroSeen.v1";

/** Whether this browser has already dismissed the map explainer. */
export function hasSeenMapIntro(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function markMapIntroSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* storage unavailable: it will simply show again next time */
  }
}

/**
 * One-time explainer of what the map shows and what others can see. Opens
 * automatically on a first visit; reopen it from "How it works".
 */
export default function MapIntro({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const cardRef = useDialogA11y<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={cardRef}
        className="modal-card map-intro"
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-intro-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="map-intro-title">How SafeSips keeps you private</h2>
        <ul className="map-intro-list">
          <li>
            <span className="legend-swatch swatch-blue" aria-hidden="true" />
            <span>
              <strong>Blue dot: your exact spot.</strong> Only you see it. While
              sharing, you can choose to show it to your friends (never anyone else).
            </span>
          </li>
          <li>
            <span className="legend-swatch swatch-yellow" aria-hidden="true" />
            <span>
              <strong>Yellow circle: what others see.</strong> An anonymous
              area of about 200 m around a random point near you. While SafeSips
              is open, it follows you in steps of about 100 m.
            </span>
          </li>
          <li>
            <span className="legend-swatch swatch-gray" aria-hidden="true" />
            <span>
              <strong>Grey dots: other people sharing.</strong> Also
              approximate and anonymous.
            </span>
          </li>
        </ul>
        <p className="muted">
          Use <strong>Share for</strong> to keep your circle up for a set time,
          or only while the app is open, and tap <strong>Stop</strong> whenever
          you like. Safety reports are different: they show the exact place and
          your name.
        </p>
        <div className="modal-actions">
          <button className="btn btn-primary" type="button" onClick={onClose} data-autofocus>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
