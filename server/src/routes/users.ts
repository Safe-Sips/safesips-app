import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody, parseQuery } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { deleteClerkUser, fetchClerkImageUrl } from "../auth/clerk.js";
import { config } from "../config.js";
import { deleteAccountData, exportAccountData } from "../repos/account.js";
import { defaultCursor, listActivity } from "../repos/activity.js";
import { computeStats } from "../repos/stats.js";
import { cleanAvatarUrl, findUserById, setUserImage } from "../repos/users.js";
import { backUpConnections, savedConnectionCounts } from "../connectionBackup.js";
import { hideSpotsBetween } from "../friendSpots.js";
import { blockUser, listBlocks, unblockUser } from "../repos/moderation.js";
import { emitFriendsChanged } from "../realtime.js";
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

/** What's saved to the account (Clerk) so it comes back after a server reset. */
usersRouter.get(
  "/me/backup",
  asyncHandler(async (req, res) => {
    res.json({ saved: await savedConnectionCounts(req.auth!.user) });
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

// imageUrl is only read for local test accounts (no Clerk identity).
const avatarSchema = z.object({ imageUrl: z.string().trim().max(2000).nullable().optional() });

/**
 * Refresh my profile picture. The server reads it from my Clerk account
 * itself — a picture URL sent by the client is never trusted, so nobody can
 * put someone else's photo (or any other image) on their profile.
 */
usersRouter.put(
  "/me/avatar",
  asyncHandler(async (req, res) => {
    const body = parseBody(avatarSchema, req, res);
    if (!body) return;
    const user = req.auth!.user;
    let url: string | null;
    if (user.clerk_id) {
      const fetched = await fetchClerkImageUrl(user.clerk_id);
      if (!fetched.ok) {
        res.status(503).json({ error: "Couldn't read your profile picture right now.", code: "avatar_unavailable" });
        return;
      }
      url = fetched.imageUrl ? cleanAvatarUrl(fetched.imageUrl) : null;
    } else if (config.allowTestToken) {
      url = body.imageUrl ? cleanAvatarUrl(body.imageUrl) : null;
      if (body.imageUrl && !url) {
        res.status(400).json({ error: "Profile pictures must come from your SafeSips account.", code: "bad_avatar" });
        return;
      }
    } else {
      res.status(400).json({ error: "This account has no profile picture source.", code: "bad_avatar" });
      return;
    }
    setUserImage(req.auth!.userId, url);
    res.json({ imageUrl: url });
  })
);

/** People I've blocked. */
usersRouter.get(
  "/me/blocks",
  asyncHandler(async (req, res) => {
    res.json({ blocks: listBlocks(req.auth!.userId) });
  })
);

/** Block someone: their posts and reports disappear for me; friendship ends. */
usersRouter.post(
  "/:id/block",
  asyncHandler(async (req, res) => {
    const me = req.auth!.userId;
    const other = req.params.id;
    if (other === me || !findUserById(other)) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    // Hide exact spots before the friendship row disappears with the block.
    hideSpotsBetween(me, other);
    blockUser(me, other);
    backUpConnections(me, other);
    emitFriendsChanged(other);
    res.json({ blocks: listBlocks(me) });
  })
);

usersRouter.delete(
  "/:id/block",
  asyncHandler(async (req, res) => {
    unblockUser(req.auth!.userId, req.params.id);
    res.json({ blocks: listBlocks(req.auth!.userId) });
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
