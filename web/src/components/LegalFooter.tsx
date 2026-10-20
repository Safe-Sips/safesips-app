import { EMERGENCY_NUMBER } from "../content/firstAid";

interface LegalFooterProps {
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
  /** Reopens the map explainer. */
  onOpenHowItWorks?: () => void;
}

export default function LegalFooter({
  onOpenPrivacy,
  onOpenTerms,
  onOpenHowItWorks,
}: LegalFooterProps) {
  return (
    <footer className="legal-footer" aria-label="Legal and safety information">
      <p className="legal-emergency">
        SafeSips is <strong>not</strong> an emergency service. Call{" "}
        <strong>{EMERGENCY_NUMBER}</strong> (or your local emergency number) in an
        emergency.
      </p>
      <p className="legal-links">
        {onOpenHowItWorks && (
          <>
            <button type="button" className="legal-link" onClick={onOpenHowItWorks}>
              How it works
            </button>
            <span aria-hidden> · </span>
          </>
        )}
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
