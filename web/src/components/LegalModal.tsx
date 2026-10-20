import { useId } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y";

interface LegalModalProps {
  title: string;
  body: string;
  open: boolean;
  onClose: () => void;
}

export default function LegalModal({
  title,
  body,
  open,
  onClose,
}: LegalModalProps) {
  const titleId = useId();
  const cardRef = useDialogA11y<HTMLDivElement>(open, onClose);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={cardRef}
        className="modal-card legal-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id={titleId}>{title}</h2>
        <div className="legal-body">{body}</div>
        <div className="modal-actions">
          <button className="btn btn-primary" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
