import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { sendPushToUser } from "../push.js";
import { emitContactsChanged, emitFriendsChanged } from "../realtime.js";
import { requestContactForUser } from "../repos/emergencyContacts.js";
import {
  acceptFriend,
  areFriends,
  getFriendProfile,
  getFriendsOverview,
  removeFriendship,
  requestFriend,
} from "../repos/friends.js";
import { findUserById } from "../repos/users.js";

/** Friends (other SafeSips users) and their profiles. */
export const friendsRouter = Router();
friendsRouter.use(requireAuth);

const nameOf = (userId: string) => findUserById(userId)?.display_name ?? "A SafeSips user";

friendsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(getFriendsOverview(req.auth!.userId));
  })
);

const requestSchema = z.object({ identifier: z.string().trim().min(1).max(254) });

/** Send a friend request by SafeSips code or account email. */
friendsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parseBody(requestSchema, req, res);
    if (!body) return;
    const me = req.auth!.userId;
    const result = requestFriend(me, body.identifier);
    if (!result.ok) {
      res.status(400).json({ error: result.error, code: "friend_request_failed" });
      return;
    }
    if (result.notify) {
      emitFriendsChanged(result.notify.userId);
      void sendPushToUser(result.notify.userId, result.notify.accepted
        ? { title: "New friend", body: `You and ${nameOf(me)} are now friends on SafeSips.`, url: "/friends", tag: "friend-accepted" }
        : { title: "Friend request", body: `${nameOf(me)} wants to be friends on SafeSips.`, url: "/friends", tag: "friend-request" });
    }
    res.json({ message: result.message, overview: getFriendsOverview(me) });
  })
);

friendsRouter.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const me = req.auth!.userId;
    const requesterId = acceptFriend(me, req.params.id);
    if (!requesterId) {
      res.status(404).json({ error: "Request not found." });
      return;
    }
    emitFriendsChanged(requesterId);
    void sendPushToUser(requesterId, {
      title: "New friend",
      body: `${nameOf(me)} accepted your friend request.`,
      url: "/friends",
      tag: "friend-accepted",
    });
    res.json(getFriendsOverview(me));
  })
);

/** Decline a request, cancel one I sent, or unfriend. */
friendsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const me = req.auth!.userId;
    const other = removeFriendship(me, req.params.id);
    if (!other) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    emitFriendsChanged(other);
    res.json(getFriendsOverview(me));
  })
);

/** A friend's profile (404 unless we're friends, so ids reveal nothing). */
friendsRouter.get(
  "/:userId/profile",
  asyncHandler(async (req, res) => {
    const profile = getFriendProfile(req.auth!.userId, req.params.userId);
    if (!profile) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    res.json(profile);
  })
);

/** Ask a friend to be my emergency contact (they still have to accept). */
friendsRouter.post(
  "/:userId/emergency-contact",
  asyncHandler(async (req, res) => {
    const me = req.auth!.userId;
    const friendId = req.params.userId;
    if (!areFriends(me, friendId)) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    const result = requestContactForUser(me, friendId);
    if (!result.ok) {
      res.status(400).json({ error: result.error, code: "contact_request_failed" });
      return;
    }
    if (result.notifyUserId) {
      emitContactsChanged(result.notifyUserId);
      void sendPushToUser(result.notifyUserId, {
        title: "Emergency contact request",
        body: `${nameOf(me)} wants you as their SafeSips emergency contact.`,
        url: "/checkins",
        tag: "contact-request",
      });
    }
    res.json(getFriendProfile(me, friendId));
  })
);
