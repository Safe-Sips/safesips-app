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
  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="legal-modal-title"
      onClick={onClose}
    >
      <div
        className="modal-card legal-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="legal-modal-title">{title}</h2>
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
