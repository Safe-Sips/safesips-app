import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ThreadDTO } from "@safesips/shared";
import { api } from "../api";
import { timeAgo } from "../format";

/** Matches the server's page size (routes/forum.ts PAGE_LIMIT). */
const PAGE_SIZE = 30;

export default function ForumListPage() {
  const [threads, setThreads] = useState<ThreadDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadMore = async () => {
    const last = threads?.[threads.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const next = await api.listThreads(last.lastPostAt);
      setThreads((t) => [...(t ?? []), ...next.filter((n) => !t?.some((x) => x.id === n.id))]);
      setHasMore(next.length >= PAGE_SIZE);
    } catch {
      setError("Couldn't load more discussions. Try again.");
    } finally {
      setLoadingMore(false);
    }
  };
  const retry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let active = true;
    api
      .listThreads()
      .then((t) => {
        if (active) {
          setThreads(t);
          setHasMore(t.length >= PAGE_SIZE);
        }
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
      {hasMore && (
        <button className="btn btn-ghost btn-block" type="button" onClick={loadMore} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
