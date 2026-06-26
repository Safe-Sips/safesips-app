import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseQuery } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { defaultCursor, listActivity } from "../repos/activity.js";
import { computeStats } from "../repos/stats.js";

export const usersRouter = Router();
usersRouter.use(requireAuth);

const ACTIVITY_LIMIT = 40;
const activityQuery = z.object({ cursor: z.coerce.number().optional() });

usersRouter.get(
  "/me/stats",
  asyncHandler(async (req, res) => {
    res.json(computeStats(req.auth!.userId));
  })
);

usersRouter.get(
  "/me/activity",
  asyncHandler(async (req, res) => {
    const q = parseQuery(activityQuery, req, res);
    if (!q) return;
    const before = q.cursor ?? defaultCursor();
    res.json(listActivity(req.auth!.userId, before, ACTIVITY_LIMIT));
  })
);
