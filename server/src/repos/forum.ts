import type {
  PostDTO,
  ThreadDTO,
  ThreadDetailDTO,
} from "@safesips/shared";
import { db } from "../db.js";
import { genId, nowMs } from "../util.js";
import { hiddenForViewerSql } from "./moderation.js";

interface ThreadJoinRow {
  id: string;
  author_id: string;
  title: string;
  category: string;
  created_at: number;
  last_post_at: number;
  post_count: number;
  author_name: string;
}

interface PostJoinRow {
  is_opener: number;
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: number;
  author_name: string;
  vote_count: number;
  viewer_vote: number;
}

// The opening post: the thread's first post (by insertion order, so a reply
// in the same millisecond can't be mistaken for it).
const OPENER_ID_SQL = (threadCol: string) =>
  `(SELECT op0.id FROM forum_posts op0 WHERE op0.thread_id = ${threadCol}
     ORDER BY op0.created_at ASC, op0.rowid ASC LIMIT 1)`;

// A thread is hidden from a viewer who blocked its author or reported its
// opening post.
const selectThreads = db.prepare(
  `SELECT t.*, u.display_name AS author_name
   FROM forum_threads t JOIN users u ON u.id = t.author_id
   WHERE t.status = 'visible' AND t.last_post_at < @before
     AND t.author_id NOT IN (SELECT blocked_id FROM user_blocks WHERE blocker_id = @viewer)
     AND NOT EXISTS (SELECT 1 FROM content_flags f
                      WHERE f.target_type = 'post' AND f.reporter_id = @viewer
                        AND f.target_id = ${OPENER_ID_SQL("t.id")})
   ORDER BY t.last_post_at DESC
   LIMIT @limit`
);
const blockedBy = db.prepare(
  `SELECT 1 AS x FROM user_blocks WHERE blocker_id = ? AND blocked_id = ?`
);
const selectThreadById = db.prepare(
  `SELECT t.*, u.display_name AS author_name
   FROM forum_threads t JOIN users u ON u.id = t.author_id
   WHERE t.id = ? AND t.status = 'visible'`
);
const insertThread = db.prepare(
  `INSERT INTO forum_threads
     (id, author_id, title, category, created_at, last_post_at, post_count, status)
   VALUES (@id, @author_id, @title, @category, @created_at, @last_post_at, 1, 'visible')`
);

const POST_SELECT_BASE = `
  SELECT p.id, p.thread_id, p.author_id, p.body, p.created_at,
         ${OPENER_ID_SQL("p.thread_id")} = p.id AS is_opener,
         u.display_name AS author_name,
         (SELECT COALESCE(SUM(v.value), 0) FROM forum_post_votes v WHERE v.post_id = p.id) AS vote_count,
         COALESCE((SELECT v.value FROM forum_post_votes v WHERE v.post_id = p.id AND v.user_id = @viewer), 0) AS viewer_vote
  FROM forum_posts p
  JOIN users u ON u.id = p.author_id
`;
const selectPostsByThread = db.prepare(
  `${POST_SELECT_BASE}
   WHERE p.thread_id = @threadId AND p.status = 'visible'
   ${hiddenForViewerSql("p.author_id", "post", "p.id")}
   ORDER BY p.created_at ASC`
);
const postRow = db.prepare(
  `SELECT p.id, p.thread_id, p.author_id, ${OPENER_ID_SQL("p.thread_id")} AS opener_id
     FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id
    WHERE p.id = ? AND p.status = 'visible' AND t.status = 'visible'`
);
const setPostStatus = db.prepare(`UPDATE forum_posts SET status = ? WHERE id = ?`);
const setThreadStatus = db.prepare(`UPDATE forum_threads SET status = ? WHERE id = ?`);
const unbumpThread = db.prepare(
  `UPDATE forum_threads SET post_count = MAX(post_count - 1, 0) WHERE id = ?`
);
const threadAuthor = db.prepare(
  `SELECT author_id FROM forum_threads WHERE id = ? AND status = 'visible'`
);
const selectPostById = db.prepare(
  `${POST_SELECT_BASE} WHERE p.id = @id AND p.status = 'visible'`
);
const insertPost = db.prepare(
  `INSERT INTO forum_posts (id, thread_id, author_id, body, created_at, status)
   VALUES (@id, @thread_id, @author_id, @body, @created_at, 'visible')`
);
const bumpThread = db.prepare(
  `UPDATE forum_threads SET last_post_at = ?, post_count = post_count + 1 WHERE id = ?`
);
const threadExists = db.prepare(
  `SELECT id FROM forum_threads WHERE id = ? AND status = 'visible'`
);

const upsertPostVote = db.prepare(
  `INSERT INTO forum_post_votes (post_id, user_id, value, created_at)
   VALUES (?, ?, ?, ?)
   ON CONFLICT(post_id, user_id) DO UPDATE SET value = excluded.value, created_at = excluded.created_at`
);
const deletePostVote = db.prepare(
  `DELETE FROM forum_post_votes WHERE post_id = ? AND user_id = ?`
);
const scorePostVotes = db.prepare(
  `SELECT COALESCE(SUM(value), 0) AS s FROM forum_post_votes WHERE post_id = ?`
);
const selectPostVote = db.prepare(
  `SELECT value FROM forum_post_votes WHERE post_id = ? AND user_id = ?`
);
const postAuthor = db.prepare(
  `SELECT author_id FROM forum_posts WHERE id = ? AND status = 'visible'`
);

function threadToDTO(row: ThreadJoinRow): ThreadDTO {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    authorId: row.author_id,
    authorDisplayName: row.author_name,
    postCount: row.post_count,
    createdAt: row.created_at,
    lastPostAt: row.last_post_at,
  };
}

function postToDTO(row: PostJoinRow): PostDTO {
  return {
    isOpener: row.is_opener === 1,
    id: row.id,
    threadId: row.thread_id,
    body: row.body,
    authorId: row.author_id,
    authorDisplayName: row.author_name,
    voteCount: row.vote_count,
    viewerVote: row.viewer_vote,
    createdAt: row.created_at,
  };
}

export function listThreads(before: number, limit: number, viewerId: string): ThreadDTO[] {
  const rows = selectThreads.all({ before, limit, viewer: viewerId }) as ThreadJoinRow[];
  return rows.map(threadToDTO);
}

/** A visible post with what's needed to moderate it, or undefined. */
export function getPostForModeration(
  postId: string
): { threadId: string; authorId: string; isOpener: boolean } | undefined {
  const row = postRow.get(postId) as
    | { id: string; thread_id: string; author_id: string; opener_id: string }
    | undefined;
  if (!row) return undefined;
  return { threadId: row.thread_id, authorId: row.author_id, isOpener: row.id === row.opener_id };
}

/**
 * Take a post out of view (status 'deleted' by its author, 'hidden' by
 * moderation). Hiding a discussion's opening post hides the whole discussion.
 */
export const removePost = db.transaction((postId: string, status: "deleted" | "hidden"): void => {
  const p = getPostForModeration(postId);
  if (!p) return;
  if (p.isOpener) {
    setThreadStatus.run(status, p.threadId);
  } else {
    setPostStatus.run(status, postId);
    unbumpThread.run(p.threadId);
  }
}) as (postId: string, status: "deleted" | "hidden") => void;

const postAnyStatus = db.prepare(
  `SELECT p.thread_id, p.status AS post_status, t.status AS thread_status,
          ${OPENER_ID_SQL("p.thread_id")} = p.id AS opener
     FROM forum_posts p JOIN forum_threads t ON t.id = p.thread_id WHERE p.id = ?`
);
const recountThread = db.prepare(
  `UPDATE forum_threads SET post_count =
     (SELECT COUNT(*) FROM forum_posts WHERE thread_id = forum_threads.id AND status = 'visible')
   WHERE id = ?`
);

/**
 * A moderator's hide / restore. An opening post stands for its discussion.
 * Content its author deleted is never restored.
 */
export function moderatePost(postId: string, action: "hide" | "restore"): "ok" | "deleted" | "missing" {
  const row = postAnyStatus.get(postId) as
    | { thread_id: string; post_status: string; thread_status: string; opener: number }
    | undefined;
  if (!row) return "missing";
  const status = row.opener ? row.thread_status : row.post_status;
  if (status === "deleted" || (!row.opener && row.thread_status === "deleted")) return "deleted";
  const next = action === "hide" ? "hidden" : "visible";
  if (row.opener) setThreadStatus.run(next, row.thread_id);
  else setPostStatus.run(next, postId);
  recountThread.run(row.thread_id);
  return "ok";
}

const hideAuthorPosts = db.prepare(
  `UPDATE forum_posts SET status = 'suspended' WHERE author_id = ? AND status = 'visible'`
);
const hideAuthorThreads = db.prepare(
  `UPDATE forum_threads SET status = 'suspended' WHERE author_id = ? AND status = 'visible'`
);
const showAuthorPosts = db.prepare(
  `UPDATE forum_posts SET status = 'visible' WHERE author_id = ? AND status = 'suspended'`
);
const showAuthorThreads = db.prepare(
  `UPDATE forum_threads SET status = 'visible' WHERE author_id = ? AND status = 'suspended'`
);
const recountAll = db.prepare(
  `UPDATE forum_threads SET post_count =
     (SELECT COUNT(*) FROM forum_posts WHERE thread_id = forum_threads.id AND status = 'visible')
   WHERE id IN (SELECT thread_id FROM forum_posts WHERE author_id = ?)`
);

/** Suspending an author takes their posts and discussions down; reinstating brings back exactly those. */
export const setAuthorSuspended = db.transaction((authorId: string, suspended: boolean): void => {
  if (suspended) {
    hideAuthorPosts.run(authorId);
    hideAuthorThreads.run(authorId);
  } else {
    showAuthorPosts.run(authorId);
    showAuthorThreads.run(authorId);
  }
  recountAll.run(authorId);
}) as (authorId: string, suspended: boolean) => void;

export function getThreadAuthor(threadId: string): string | undefined {
  return (threadAuthor.get(threadId) as { author_id: string } | undefined)?.author_id;
}

/** The author deletes their discussion (it disappears with its replies). */
export function deleteThread(threadId: string): void {
  setThreadStatus.run("deleted", threadId);
}

export function threadExistsById(threadId: string): boolean {
  return threadExists.get(threadId) !== undefined;
}

/** Create a thread plus its first post atomically. Returns the thread + ids. */
export const createThread = db.transaction(
  (authorId: string, input: { title: string; body: string; category: string }) => {
    const now = nowMs();
    const threadId = genId();
    const postId = genId();
    insertThread.run({
      id: threadId,
      author_id: authorId,
      title: input.title,
      category: input.category,
      created_at: now,
      last_post_at: now,
    });
    insertPost.run({
      id: postId,
      thread_id: threadId,
      author_id: authorId,
      body: input.body,
      created_at: now,
    });
    return { threadId, postId };
  }
) as (
  authorId: string,
  input: { title: string; body: string; category: string }
) => { threadId: string; postId: string };

export function getThreadDTO(threadId: string): ThreadDTO | undefined {
  const row = selectThreadById.get(threadId) as ThreadJoinRow | undefined;
  return row ? threadToDTO(row) : undefined;
}

export function getThreadDetail(
  threadId: string,
  viewerId: string
): ThreadDetailDTO | undefined {
  const thread = getThreadDTO(threadId);
  if (!thread) return undefined;
  // Someone I blocked: their discussion is gone for me.
  if (blockedBy.get(viewerId, thread.authorId)) return undefined;
  const posts = (
    selectPostsByThread.all({ threadId, viewer: viewerId }) as PostJoinRow[]
  ).map(postToDTO);
  return { thread, posts };
}

/** Add a reply and bump the thread's counters atomically. */
export const createPost = db.transaction(
  (authorId: string, threadId: string, body: string) => {
    const now = nowMs();
    const postId = genId();
    insertPost.run({
      id: postId,
      thread_id: threadId,
      author_id: authorId,
      body,
      created_at: now,
    });
    bumpThread.run(now, threadId);
    return postId;
  }
) as (authorId: string, threadId: string, body: string) => string;

export function getPostDTO(postId: string, viewerId: string): PostDTO | undefined {
  const row = selectPostById.get({ id: postId, viewer: viewerId }) as
    | PostJoinRow
    | undefined;
  return row ? postToDTO(row) : undefined;
}

export function getPostAuthor(postId: string): string | undefined {
  const row = postAuthor.get(postId) as { author_id: string } | undefined;
  return row?.author_id;
}

/** Set this user's vote on a post to +1 or -1 (upsert). */
export function setPostVote(postId: string, userId: string, value: 1 | -1): void {
  upsertPostVote.run(postId, userId, value, nowMs());
}

export function clearPostVote(postId: string, userId: string): void {
  deletePostVote.run(postId, userId);
}

/** Net score: upvotes minus downvotes. */
export function postVoteScore(postId: string): number {
  return (scorePostVotes.get(postId) as { s: number }).s;
}

/** This user's current vote on a post: 1, -1, or 0. */
export function getPostVote(postId: string, userId: string): number {
  const row = selectPostVote.get(postId, userId) as { value: number } | undefined;
  return row?.value ?? 0;
}
