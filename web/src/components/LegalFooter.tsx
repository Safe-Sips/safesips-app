interface LegalFooterProps {
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
}

export default function LegalFooter({
  onOpenPrivacy,
  onOpenTerms,
}: LegalFooterProps) {
  return (
    <footer className="legal-footer" aria-label="Legal and safety information">
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
    </footer>
  );
}
