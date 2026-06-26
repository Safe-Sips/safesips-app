import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { ThreadDetailDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import PostItem from "../components/PostItem";
import { timeAgo } from "../format";

export default function ForumThreadPage() {
  const { id } = useParams();
  const [detail, setDetail] = useState<ThreadDetailDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [replyError, setReplyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    api
      .getThread(id)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch(() => {
        if (active) setError("Couldn't load this discussion.");
      });
    return () => {
      active = false;
    };
  }, [id]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setReplyError(null);
    setBusy(true);
    try {
      const post = await api.createPost(id, reply);
      setDetail((d) =>
        d
          ? {
              ...d,
              posts: [...d.posts, post],
              thread: { ...d.thread, postCount: d.thread.postCount + 1 },
            }
          : d
      );
      setReply("");
    } catch (err) {
      setReplyError(err instanceof ApiError ? err.message : "Could not reply.");
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
        <Link className="back-link" to="/forum">
          ← Forum
        </Link>
      </div>
    );
  }
  if (!detail) {
    return (
      <div className="page">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="page thread-page">
      <div className="page-head">
        <Link className="back-link" to="/forum">
          ← Forum
        </Link>
        <h1>{detail.thread.title}</h1>
        <p className="muted">
          by {detail.thread.authorDisplayName} · {timeAgo(detail.thread.createdAt)}
        </p>
      </div>

      <ul className="post-list">
        {detail.posts.map((p) => (
          <PostItem key={p.id} post={p} />
        ))}
      </ul>

      <form className="card reply-form" onSubmit={submit}>
        <label className="field">
          <span>Add a reply</span>
          <textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            required
          />
        </label>
        {replyError && <p className="error">{replyError}</p>}
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Posting…" : "Reply"}
        </button>
      </form>
    </div>
  );
}
