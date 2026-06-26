import { useState } from "react";
import type { LatLng, ReportSafety } from "@safesips/shared";

interface MarkUnsafeDialogProps {
  point: LatLng;
  placeLabel: string | null;
  busy: boolean;
  error?: string | null;
  onSubmit: (input: {
    safety: ReportSafety;
    category: string | null;
    note: string | null;
  }) => void;
  onCancel: () => void;
}

const UNSAFE_CATEGORIES = [
  "Drink spiking",
  "Harassment",
  "Felt followed",
  "Poorly lit",
  "Aggressive crowd",
];
const SAFE_CATEGORIES = ["Well lit", "Helpful staff", "Security present", "Busy & safe"];

export default function MarkUnsafeDialog({
  point,
  placeLabel,
  busy,
  error,
  onSubmit,
  onCancel,
}: MarkUnsafeDialogProps) {
  const [safety, setSafety] = useState<ReportSafety>("unsafe");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");

  const categories = safety === "unsafe" ? UNSAFE_CATEGORIES : SAFE_CATEGORIES;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card">
        <h2>Report this spot</h2>

        {/* This warning is DISTINCT from the presence sensitive-location notice. */}
        <p className="report-warning">
          ⚠️ This publishes the <strong>exact location</strong> you picked,
          publicly, linked to your display name. This is different from the
          private map circle — only share places (a venue, a street), never your
          home.
        </p>

        <p className="muted report-coords">
          {placeLabel ? `${placeLabel} · ` : ""}
          {point.lat.toFixed(5)}, {point.lng.toFixed(5)}
        </p>

        <div className="seg">
          <button
            type="button"
            className={`seg-btn${safety === "unsafe" ? " is-on seg-danger" : ""}`}
            onClick={() => setSafety("unsafe")}
          >
            ⚠️ Unsafe
          </button>
          <button
            type="button"
            className={`seg-btn${safety === "safe" ? " is-on seg-safe" : ""}`}
            onClick={() => setSafety("safe")}
          >
            ✓ Safe
          </button>
        </div>

        <label className="field">
          <span>What happened? (optional)</span>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">Choose a tag…</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Note (optional)</span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Anything others should know…"
          />
        </label>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            className={safety === "unsafe" ? "btn btn-danger" : "btn btn-primary"}
            disabled={busy}
            onClick={() =>
              onSubmit({
                safety,
                category: category || null,
                note: note.trim() || null,
              })
            }
          >
            {busy ? "Publishing…" : "Publish report"}
          </button>
        </div>
      </div>
    </div>
  );
}
