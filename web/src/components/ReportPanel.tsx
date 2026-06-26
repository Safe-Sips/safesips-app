import { useState } from "react";
import type { ReportDTO } from "@safesips/shared";
import { api } from "../api";
import { timeAgo } from "../format";

interface ReportPanelProps {
  report: ReportDTO;
  isOwn: boolean;
  onClose: () => void;
  onChange: (updated: ReportDTO) => void;
  onDelete: (id: string) => void;
  onFindHavens: (report: ReportDTO) => void;
}

export default function ReportPanel({
  report,
  isOwn,
  onClose,
  onChange,
  onDelete,
  onFindHavens,
}: ReportPanelProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleVote = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = report.viewerHasVoted
        ? await api.unvoteReport(report.id)
        : await api.voteReport(report.id);
      onChange({ ...report, voteCount: r.voteCount, viewerHasVoted: r.viewerHasVoted });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vote failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.deleteReport(report.id);
      onDelete(report.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
      setBusy(false);
    }
  };

  return (
    <aside className="report-panel">
      <button className="panel-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <span
        className={`report-badge ${report.safety === "unsafe" ? "is-unsafe" : "is-safe"}`}
      >
        {report.safety === "unsafe" ? "⚠️ Unsafe" : "✓ Safe"}
      </span>
      {report.placeLabel && <h3>{report.placeLabel}</h3>}
      {report.category && <p className="report-tag">{report.category}</p>}
      {report.note && <p className="report-note">{report.note}</p>}
      <p className="muted report-by">
        by {report.authorDisplayName} · {timeAgo(report.createdAt)}
      </p>

      <div className="report-actions">
        <button
          className={`btn btn-secondary${report.viewerHasVoted ? " is-voted" : ""}`}
          onClick={toggleVote}
          disabled={busy || isOwn}
          title={isOwn ? "You can't upvote your own report" : "Upvote"}
        >
          ▲ {report.voteCount} {report.viewerHasVoted ? "Voted" : "Upvote"}
        </button>
        {report.safety === "unsafe" && (
          <button className="btn btn-primary" onClick={() => onFindHavens(report)}>
            Find help nearby
          </button>
        )}
      </div>
      {isOwn && (
        <button className="btn btn-danger btn-sm btn-block" onClick={remove} disabled={busy}>
          Delete my report
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </aside>
  );
}
