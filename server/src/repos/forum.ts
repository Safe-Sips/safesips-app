import type {
  PostDTO,
  ThreadDTO,
  ThreadDetailDTO,
} from "@safesips/shared";
import { db } from "../db.js";
import { genId, nowMs } from "../util.js";

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
  id: string;
  thread_id: string;
  author_id: string;
  body: string;
  created_at: number;
  author_name: string;
  vote_count: number;
  viewer_vote: number;
}

const selectThreads = db.prepare(
  `SELECT t.*, u.display_name AS author_name
   FROM forum_threads t JOIN users u ON u.id = t.author_id
   WHERE t.status = 'visible' AND t.last_post_at < ?
   ORDER BY t.last_post_at DESC
   LIMIT ?`
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
         u.display_name AS author_name,
         (SELECT COALESCE(SUM(v.value), 0) FROM forum_post_votes v WHERE v.post_id = p.id) AS vote_count,
         COALESCE((SELECT v.value FROM forum_post_votes v WHERE v.post_id = p.id AND v.user_id = @viewer), 0) AS viewer_vote
  FROM forum_posts p
  JOIN users u ON u.id = p.author_id
`;
const selectPostsByThread = db.prepare(
  `${POST_SELECT_BASE}
   WHERE p.thread_id = @threadId AND p.status = 'visible'
   ORDER BY p.created_at ASC`
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

export function listThreads(before: number, limit: number): ThreadDTO[] {
  const rows = selectThreads.all(before, limit) as ThreadJoinRow[];
  return rows.map(threadToDTO);
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
