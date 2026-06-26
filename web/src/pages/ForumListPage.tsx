import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ThreadDTO } from "@safesips/shared";
import { api } from "../api";
import { timeAgo } from "../format";

export default function ForumListPage() {
  const [threads, setThreads] = useState<ThreadDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listThreads()
      .then((t) => {
        if (active) setThreads(t);
      })
      .catch(() => {
        if (active) setError("Couldn't load the forum.");
      });
    return () => {
      active = false;
    };
  }, []);

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

      {error && <p className="error">{error}</p>}
      {threads && threads.length === 0 && (
        <p className="muted">No discussions yet — start the first one.</p>
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
