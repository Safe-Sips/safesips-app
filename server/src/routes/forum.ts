import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody, parseQuery } from "../http.js";
import { requireAuth, requireVerified } from "../auth/middleware.js";
import { nowMs } from "../util.js";
import { logActivity } from "../repos/activity.js";
import * as forum from "../repos/forum.js";

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
    res.json(forum.listThreads(before, PAGE_LIMIT));
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
    const postId = forum.createPost(req.auth!.userId, req.params.id, body.body);
    const thread = forum.getThreadDTO(req.params.id);
    logActivity(req.auth!.userId, "post_created", postId, thread?.title ?? null);
    res.status(201).json(forum.getPostDTO(postId, req.auth!.userId));
  })
);

forumRouter.post(
  "/posts/:id/vote",
  requireVerified,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const author = forum.getPostAuthor(id);
    if (!author) {
      res.status(404).json({ error: "Post not found." });
      return;
    }
    if (author === req.auth!.userId) {
      res.status(400).json({ error: "You can't upvote your own post.", code: "self_vote" });
      return;
    }
    forum.addPostVote(id, req.auth!.userId);
    res.json({ voteCount: forum.postVoteCount(id), viewerHasVoted: true });
  })
);

forumRouter.delete(
  "/posts/:id/vote",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    forum.removePostVote(id, req.auth!.userId);
    res.json({ voteCount: forum.postVoteCount(id), viewerHasVoted: false });
  })
);
