import type { ReactNode } from "react";

/**
 * Optional detail behind a small "More info" toggle, so screens show only what
 * you need to act on. Native <details>: works with keyboards and screen readers.
 */
export default function MoreInfo({ label = "More info", children }: { label?: string; children: ReactNode }) {
  return (
    <details className="more-info">
      <summary>{label}</summary>
      <div className="more-info-body">{children}</div>
    </details>
  );
}
