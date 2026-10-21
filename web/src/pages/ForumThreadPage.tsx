import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import type { ThreadDetailDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import PostItem from "../components/PostItem";
import { timeAgo } from "../format";

export default function ForumThreadPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
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
        if (active) setError("Couldn't load this discussion. It may have been deleted.");
      });
    return () => {
      active = false;
    };
  }, [id]);

  const [threadError, setThreadError] = useState<string | null>(null);
  const deleteDiscussion = async () => {
    if (!id || !window.confirm("Delete this discussion? Everyone's replies in it will disappear too.")) return;
    setThreadError(null);
    try {
      await api.deleteThread(id);
      navigate("/forum", { replace: true });
    } catch (err) {
      setThreadError(err instanceof ApiError ? err.message : "Couldn't delete the discussion. Try again.");
    }
  };

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
      setReplyError(err instanceof ApiError ? err.message : "Couldn't post your reply. Try again.");
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
          {user?.id === detail.thread.authorId && (
            <>
              {" · "}
              <button className="btn-link" type="button" onClick={deleteDiscussion}>
                Delete discussion
              </button>
            </>
          )}
        </p>
        {threadError && <p className="error">{threadError}</p>}
      </div>

      <ul className="post-list">
        {detail.posts.map((p) => (
          <PostItem
            key={p.id}
            post={p}
            isOpener={p.isOpener}
            onRemoved={(postId) => {
              // Reporting the opening post hides the whole discussion for you.
              if (p.isOpener) {
                navigate("/forum", { replace: true });
                return;
              }
              setDetail((d) =>
                d
                  ? {
                      ...d,
                      posts: d.posts.filter((x) => x.id !== postId),
                      thread: { ...d.thread, postCount: Math.max(0, d.thread.postCount - 1) },
                    }
                  : d
              );
            }}
            onBlocked={(authorId) => {
              if (authorId === detail.thread.authorId) {
                navigate("/forum", { replace: true });
                return;
              }
              setDetail((d) => (d ? { ...d, posts: d.posts.filter((x) => x.authorId !== authorId) } : d));
            }}
          />
        ))}
      </ul>

      <form className="card reply-form" onSubmit={submit}>
        <label className="field">
          <span>Reply</span>
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
