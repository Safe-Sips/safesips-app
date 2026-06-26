import { useState } from "react";
import type { PostDTO } from "@safesips/shared";
import { api } from "../api";
import { timeAgo } from "../format";

export default function PostItem({ post }: { post: PostDTO }) {
  const [voteCount, setVoteCount] = useState(post.voteCount);
  const [voted, setVoted] = useState(post.viewerHasVoted);
  const [busy, setBusy] = useState(false);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    const prevVoted = voted;
    const prevCount = voteCount;
    setVoted(!voted);
    setVoteCount((c) => c + (voted ? -1 : 1));
    try {
      const r = voted
        ? await api.unvotePost(post.id)
        : await api.votePost(post.id);
      setVoted(r.viewerHasVoted);
      setVoteCount(r.voteCount);
    } catch {
      setVoted(prevVoted);
      setVoteCount(prevCount);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="post-item">
      <div className="vote-col">
        <button
          className={`vote-btn${voted ? " is-voted" : ""}`}
          onClick={toggle}
          disabled={busy}
          aria-pressed={voted}
          aria-label={voted ? "Remove upvote" : "Upvote"}
        >
          ▲
        </button>
        <span className="vote-count">{voteCount}</span>
      </div>
      <div className="post-body">
        <div className="post-meta">
          <strong>{post.authorDisplayName}</strong>
          <span className="muted"> · {timeAgo(post.createdAt)}</span>
        </div>
        <p>{post.body}</p>
      </div>
    </li>
  );
}
