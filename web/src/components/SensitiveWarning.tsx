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
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>Before you share</h2>
        <p>
          Others will see an approximate <strong>200&nbsp;m area</strong>, not
          your exact position. Even so, please think twice before sharing from a
          sensitive place such as your <strong>home</strong>, school, workplace,
          a shelter, or a medical facility.
        </p>
        <p className="muted">
          Location masking reduces precision but does not eliminate every
          privacy risk. SafeSips is not an emergency service — call 911 in an
          emergency. You can stop sharing at any time.
        </p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={onConfirm}>
            I understand, continue
          </button>
        </div>
      </div>
    </div>
  );
}
