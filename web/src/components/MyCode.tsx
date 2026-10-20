import { useState } from "react";

/** "Your SafeSips code: ABCD-2345 [Copy]" — shared by Friends and Check-ins. */
export default function MyCode({ code, hint }: { code: string; hint: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code is visible to copy by hand */
    }
  };
  return (
    <p className="my-code">
      Your SafeSips code: <strong className="code-chip">{code}</strong>{" "}
      <button className="btn btn-ghost btn-sm" type="button" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <span className="field-hint"> {hint}</span>
    </p>
  );
}
