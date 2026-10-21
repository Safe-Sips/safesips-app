import { useState } from "react";
import type { PostDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import { timeAgo } from "../format";

export default function PostItem({
  post,
  isOpener = false,
  onRemoved,
  onBlocked,
}: {
  post: PostDTO;
  /** The post that starts the discussion (deleted with the discussion itself). */
  isOpener?: boolean;
  /** The post was deleted or reported: drop it from the list. */
  onRemoved?: (postId: string) => void;
  /** Its author was blocked: drop all of their posts. */
  onBlocked?: (authorId: string) => void;
}) {
  const { user } = useAuth();
  const isOwn = user?.id === post.authorId;
  const [score, setScore] = useState(post.voteCount);
  const [vote, setVote] = useState<number>(post.viewerVote); // -1, 0, 1
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (target: 1 | -1) => {
    if (busy || isOwn) return;
    setBusy(true);
    setError(null);
    const prevVote = vote;
    const prevScore = score;
    // Clicking the active direction again clears the vote.
    const newVote = vote === target ? 0 : target;
    setVote(newVote);
    setScore(prevScore - prevVote + newVote);
    try {
      const r =
        newVote === 0
          ? await api.unvotePost(post.id)
          : await api.votePost(post.id, target);
      setVote(r.viewerVote);
      setScore(r.voteCount);
    } catch (e) {
      setVote(prevVote);
      setScore(prevScore);
      setError(e instanceof ApiError ? e.message : "Couldn't save your vote.");
    } finally {
      setBusy(false);
    }
  };

  const act = async (confirmText: string, fn: () => Promise<unknown>, after: () => void) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
      setBusy(false);
      after();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <li className="post-item">
      <div className="vote-col">
        <button
          className={`vote-btn${vote === 1 ? " is-up" : ""}`}
          onClick={() => apply(1)}
          disabled={busy || isOwn}
          aria-pressed={vote === 1}
          aria-label="Upvote"
          title={isOwn ? "You can't vote on your own post" : undefined}
        >
          ▲
        </button>
        <span
          className={`vote-count${vote === 1 ? " is-up" : vote === -1 ? " is-down" : ""}`}
        >
          {score}
        </span>
        <button
          className={`vote-btn${vote === -1 ? " is-down" : ""}`}
          onClick={() => apply(-1)}
          disabled={busy || isOwn}
          aria-pressed={vote === -1}
          aria-label="Downvote"
        >
          ▼
        </button>
      </div>
      <div className="post-body">
        <div className="post-meta">
          <strong>{post.authorDisplayName}</strong>
          <span className="muted"> · {timeAgo(post.createdAt)}</span>
        </div>
        <p>{post.body}</p>
        <div className="post-actions">
          {isOwn ? (
            !isOpener && (
              <button
                className="btn-link"
                type="button"
                disabled={busy}
                onClick={() =>
                  act("Delete your reply?", () => api.deletePost(post.id), () => onRemoved?.(post.id))
                }
              >
                Delete
              </button>
            )
          ) : (
            <>
              <button
                className="btn-link"
                type="button"
                disabled={busy}
                onClick={() =>
                  act(
                    "Report this post? We'll hide it for you, and take it down for everyone if others report it too.",
                    () => api.flagPost(post.id),
                    () => onRemoved?.(post.id)
                  )
                }
              >
                Report
              </button>
              <button
                className="btn-link"
                type="button"
                disabled={busy}
                onClick={() =>
                  act(
                    `Block ${post.authorDisplayName}? You won't see their posts, discussions or map reports, they can't send you friend requests, and any friendship or emergency-contact link between you ends.`,
                    () => api.blockUser(post.authorId),
                    () => onBlocked?.(post.authorId)
                  )
                }
              >
                Block
              </button>
            </>
          )}
        </div>
        {error && <p className="error vote-error">{error}</p>}
      </div>
    </li>
  );
}
