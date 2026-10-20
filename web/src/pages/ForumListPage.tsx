import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ThreadDTO } from "@safesips/shared";
import { api } from "../api";
import { timeAgo } from "../format";

export default function ForumListPage() {
  const [threads, setThreads] = useState<ThreadDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    api
      .listThreads()
      .then((t) => {
        if (active) setThreads(t);
      })
      .catch(() => {
        if (active) setError("Couldn't load the forum. Check your connection and try again.");
      });
    return () => {
      active = false;
    };
  }, [attempt]);

  return (
    <div className="page forum-page">
      <div className="page-head">
        <h1>Community safety forum</h1>
        <Link className="btn btn-primary btn-sm" to="/forum/new">
          New discussion
        </Link>
      </div>
      <p className="muted">
        Share tips and look out for each other. Keep it kind and useful.
      </p>

      {error && (
        <div className="state-card" role="alert">
          <p className="error">{error}</p>
          <button className="btn btn-ghost btn-sm" type="button" onClick={retry}>
            Try again
          </button>
        </div>
      )}
      {!threads && !error && (
        <p className="muted" role="status">
          Loading discussions…
        </p>
      )}
      {threads && threads.length === 0 && (
        <div className="state-card">
          <p className="state-title">No discussions yet</p>
          <p className="muted">
            Ask about a venue, share a safety tip, or tell others what worked
            for you.
          </p>
          <Link className="btn btn-primary btn-sm" to="/forum/new">
            Start the first discussion
          </Link>
        </div>
      )}

      <ul className="thread-list">
        {threads?.map((t) => (
          <li key={t.id} className="thread-row">
            <Link to={`/forum/${t.id}`}>
              <span className="thread-title">{t.title}</span>
              <span className="thread-meta">
                {t.postCount} {t.postCount === 1 ? "post" : "posts"} · by{" "}
                {t.authorDisplayName} · {timeAgo(t.lastPostAt)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
