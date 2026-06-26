import { useState } from "react";
import type { PostDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import { timeAgo } from "../format";

export default function PostItem({ post }: { post: PostDTO }) {
  const [score, setScore] = useState(post.voteCount);
  const [vote, setVote] = useState<number>(post.viewerVote); // -1, 0, 1
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = async (target: 1 | -1) => {
    if (busy) return;
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
      setError(e instanceof ApiError ? e.message : "Couldn't vote.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="post-item">
      <div className="vote-col">
        <button
          className={`vote-btn${vote === 1 ? " is-up" : ""}`}
          onClick={() => apply(1)}
          disabled={busy}
          aria-pressed={vote === 1}
          aria-label="Upvote"
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
          disabled={busy}
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
        {error && <p className="error vote-error">{error}</p>}
      </div>
    </li>
  );
}
