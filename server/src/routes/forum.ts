import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody, parseQuery } from "../http.js";
import { requireAuth, requireVerified } from "../auth/middleware.js";
import { nowMs } from "../util.js";
import { logActivity } from "../repos/activity.js";
import * as forum from "../repos/forum.js";
import { flagContent, HIDE_AFTER_FLAGS, postingLimitError } from "../repos/moderation.js";

export const forumRouter = Router();
forumRouter.use(requireAuth);

const TITLE_MAX = 140;
const BODY_MAX = 5000;
const CATEGORY_MAX = 40;
const PAGE_LIMIT = 30;

const listQuery = z.object({ cursor: z.coerce.number().optional() });

forumRouter.get(
  "/threads",
  asyncHandler(async (req, res) => {
    const q = parseQuery(listQuery, req, res);
    if (!q) return;
    const before = q.cursor ?? nowMs() + 1;
    res.json(forum.listThreads(before, PAGE_LIMIT, req.auth!.userId));
  })
);

const threadSchema = z.object({
  title: z.string().trim().min(3, "Title is too short.").max(TITLE_MAX),
  body: z.string().trim().min(3, "Write a bit more.").max(BODY_MAX),
  category: z.string().trim().max(CATEGORY_MAX).optional(),
});

forumRouter.post(
  "/threads",
  requireVerified,
  asyncHandler(async (req, res) => {
    const body = parseBody(threadSchema, req, res);
    if (!body) return;
    const limited = postingLimitError("thread", req.auth!.userId);
    if (limited) {
      res.status(429).json({ error: limited, code: "rate_limited" });
      return;
    }
    const { threadId } = forum.createThread(req.auth!.userId, {
      title: body.title,
      body: body.body,
      category: body.category?.trim() || "general",
    });
    logActivity(req.auth!.userId, "thread_created", threadId, body.title);
    res.status(201).json(forum.getThreadDTO(threadId));
  })
);

forumRouter.get(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    const detail = forum.getThreadDetail(req.params.id, req.auth!.userId);
    if (!detail) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    res.json(detail);
  })
);

const postSchema = z.object({
  body: z.string().trim().min(1, "Reply can't be empty.").max(BODY_MAX),
});

forumRouter.post(
  "/threads/:id/posts",
  requireVerified,
  asyncHandler(async (req, res) => {
    const body = parseBody(postSchema, req, res);
    if (!body) return;
    if (!forum.threadExistsById(req.params.id)) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    const limited = postingLimitError("post", req.auth!.userId);
    if (limited) {
      res.status(429).json({ error: limited, code: "rate_limited" });
      return;
    }
    const postId = forum.createPost(req.auth!.userId, req.params.id, body.body);
    const thread = forum.getThreadDTO(req.params.id);
    logActivity(req.auth!.userId, "post_created", postId, thread?.title ?? null);
    res.status(201).json(forum.getPostDTO(postId, req.auth!.userId));
  })
);

const voteSchema = z.object({ value: z.union([z.literal(1), z.literal(-1)]) });

// Voting only needs an account (not a verified email) — it creates no public
// content. Creating threads/posts still requires verification.
forumRouter.post(
  "/posts/:id/vote",
  asyncHandler(async (req, res) => {
    const body = parseBody(voteSchema, req, res);
    if (!body) return;
    const id = req.params.id;
    const author = forum.getPostAuthor(id);
    if (!author) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    if (author === req.auth!.userId) {
      res.status(400).json({ error: "You can't vote on your own post.", code: "self_vote" });
      return;
    }
    forum.setPostVote(id, req.auth!.userId, body.value);
    res.json({ voteCount: forum.postVoteScore(id), viewerVote: body.value });
  })
);

const flagSchema = z.object({ reason: z.string().trim().max(200).optional() });

/** Report a post. Hidden for me now; for everyone once enough people report it. */
forumRouter.post(
  "/posts/:id/flag",
  asyncHandler(async (req, res) => {
    const body = parseBody(flagSchema, req, res);
    if (!body) return;
    const me = req.auth!.userId;
    const post = forum.getPostForModeration(req.params.id);
    if (!post) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    if (post.authorId === me) {
      res.status(400).json({ error: "You can delete your own post instead.", code: "own_post" });
      return;
    }
    const flags = flagContent(me, "post", req.params.id, body.reason || null);
    if (flags >= HIDE_AFTER_FLAGS) {
      forum.removePost(req.params.id, "hidden");
      // eslint-disable-next-line no-console
      console.warn(`[moderation] post ${req.params.id} hidden after ${flags} reports`);
    }
    res.json({ ok: true });
  })
);

/** Delete my own reply (to delete a discussion, delete the thread). */
forumRouter.delete(
  "/posts/:id",
  asyncHandler(async (req, res) => {
    const post = forum.getPostForModeration(req.params.id);
    if (!post || post.authorId !== req.auth!.userId) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    if (post.isOpener) {
      res.status(400).json({ error: "This starts the discussion: delete the discussion instead.", code: "opener" });
      return;
    }
    forum.removePost(req.params.id, "deleted");
    res.json({ ok: true });
  })
);

/** Delete my own discussion (with its replies). */
forumRouter.delete(
  "/threads/:id",
  asyncHandler(async (req, res) => {
    if (forum.getThreadAuthor(req.params.id) !== req.auth!.userId) {
      res.status(404).json({ error: "Discussion not found." });
      return;
    }
    forum.deleteThread(req.params.id);
    res.json({ ok: true });
  })
);

forumRouter.delete(
  "/posts/:id/vote",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    forum.clearPostVote(id, req.auth!.userId);
    res.json({ voteCount: forum.postVoteScore(id), viewerVote: 0 });
  })
);
