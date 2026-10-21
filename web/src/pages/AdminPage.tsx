import { useCallback, useEffect, useState } from "react";
import type { ModerationItemDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { timeAgo } from "../format";

/** Moderation queue: everything people reported (admins only). */
export default function AdminPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ModerationItemDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.moderationQueue()).items);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't load the queue.");
    }
  }, []);

  useEffect(() => {
    if (user?.isAdmin) void load();
  }, [user?.isAdmin, load]);

  if (!user?.isAdmin) {
    return (
      <div className="page">
        <p className="muted">This page is only for moderators.</p>
      </div>
    );
  }

  const act = async (key: string, fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusyId(key);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "That didn't work. Try again.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page admin-page">
      <div className="page-head">
        <h1>Moderation</h1>
      </div>
      <p className="muted">
        Posts and map reports that people reported. Anything reported by 3 or more
        people is already hidden. Please review new items within 24 hours.
      </p>
      {error && <p className="error">{error}</p>}
      {items && items.length === 0 && (
        <div className="state-card">
          <p className="state-title">Nothing to review</p>
        </div>
      )}
      <ul className="alert-list">
        {items?.map((it) => {
          const key = `${it.type}:${it.id}`;
          const busy = busyId === key;
          return (
            <li key={key} className={`alert-item${it.hidden ? "" : " is-new"}`}>
              <p className="alert-title">
                <strong>{it.type === "post" ? "Forum post" : "Map report"}</strong>
                {it.context ? ` · ${it.context}` : ""}
                <span className={`pill ${it.hidden ? "pill-paused" : "pill-primary"}`}>
                  {it.hidden ? "Hidden" : "Visible"}
                </span>
              </p>
              <p className="report-note">{it.text || <em className="muted">(no text)</em>}</p>
              <p className="muted alert-meta">
                by {it.authorName}
                {it.authorSuspended ? " (suspended)" : ""} · posted {timeAgo(it.createdAt)} · reported by{" "}
                {it.flags} {it.flags === 1 ? "person" : "people"}, last {timeAgo(it.lastFlagAt)}
              </p>
              {it.reasons.length > 0 && <p className="hint">Reasons: {it.reasons.join("; ")}</p>}
              <div className="data-actions">
                {it.hidden ? (
                  <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(key, () => api.moderate(it.type, it.id, "restore"))}>
                    Restore
                  </button>
                ) : (
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => act(key, () => api.moderate(it.type, it.id, "hide"))}>
                    Hide
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(key, () => api.moderate(it.type, it.id, "dismiss"))}>
                  Dismiss reports
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() =>
                    act(
                      key,
                      () => api.setUserSuspended(it.authorId, !it.authorSuspended),
                      it.authorSuspended ? undefined : `Suspend ${it.authorName}? They'll be signed out and can't use SafeSips.`
                    )
                  }
                >
                  {it.authorSuspended ? "Reinstate author" : "Suspend author"}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
