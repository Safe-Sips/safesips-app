import { EMERGENCY_NUMBER } from "../content/firstAid";
import { useDialogA11y } from "../hooks/useDialogA11y";

interface SensitiveWarningProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shown before a user shares for the first time, warning against sharing from
 * sensitive places (home, school, workplace, shelter, medical facility).
 */
export default function SensitiveWarning({
  open,
  onConfirm,
  onCancel,
}: SensitiveWarningProps) {
  const cardRef = useDialogA11y<HTMLDivElement>(open, onCancel);
  if (!open) return null;
  return (
    <div className="modal-backdrop">
      <div
        ref={cardRef}
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensitive-warning-title"
      >
        <h2 id="sensitive-warning-title">Before you share</h2>
        <p>
          Others see an approximate <strong>200&nbsp;m area</strong>, never your
          exact position. Still, think twice before sharing from a sensitive
          place like your <strong>home</strong>, school, workplace, a shelter or a
          clinic.
        </p>
        <p className="muted">
          Blurring your location lowers the risk but can't remove it entirely.
          You can stop sharing at any time. SafeSips is not an emergency
          service: in an emergency, call {EMERGENCY_NUMBER}.
        </p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            I understand
          </button>
        </div>
      </div>
    </div>
  );
}
