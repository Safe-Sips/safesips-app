import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody, parseQuery } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { deleteClerkUser } from "../auth/clerk.js";
import { deleteAccountData, exportAccountData } from "../repos/account.js";
import { defaultCursor, listActivity } from "../repos/activity.js";
import { computeStats } from "../repos/stats.js";
import { purgeUserRealtime } from "../realtime.js";

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

/** GDPR access/portability: everything stored about this account, as JSON. */
usersRouter.get(
  "/me/export",
  asyncHandler(async (req, res) => {
    const data = exportAccountData(req.auth!.userId);
    if (!data) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="safesips-data-export.json"'
    );
    res.json(data);
  })
);

// Typing the word is the guard against an accidental or scripted delete.
const deleteSchema = z.object({ confirm: z.literal("DELETE") });

/** GDPR erasure: permanently delete the account and all its data. */
usersRouter.delete(
  "/me",
  asyncHandler(async (req, res) => {
    const body = parseBody(deleteSchema, req, res);
    if (!body) return;
    const userId = req.auth!.userId;

    purgeUserRealtime(userId);
    const deleted = deleteAccountData(userId);
    if (!deleted) {
      res.status(404).json({ error: "Account not found." });
      return;
    }
    const clerkDeleted = deleted.clerkId
      ? await deleteClerkUser(deleted.clerkId)
      : false;
    res.json({ ok: true, clerkDeleted });
  })
);
