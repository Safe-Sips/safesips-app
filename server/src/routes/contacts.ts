import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { sendPushToUser } from "../push.js";
import { emitContactsChanged } from "../realtime.js";
import {
  acceptRequest,
  getOverview,
  removeLink,
  requestContact,
} from "../repos/emergencyContacts.js";
import { findUserById } from "../repos/users.js";

/** In-app emergency contacts (other SafeSips users). */
export const contactsRouter = Router();
contactsRouter.use(requireAuth);

const nameOf = (userId: string) => findUserById(userId)?.display_name ?? "A SafeSips user";

contactsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(getOverview(req.auth!.userId));
  })
);

const requestSchema = z.object({ identifier: z.string().trim().min(1).max(254) });

/** Ask someone (by account email) to be my emergency contact. */
contactsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parseBody(requestSchema, req, res);
    if (!body) return;
    const me = req.auth!.userId;
    const result = requestContact(me, body.identifier);
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
    res.json({ message: result.message, overview: getOverview(me) });
  })
);

contactsRouter.post(
  "/:id/accept",
  asyncHandler(async (req, res) => {
    const me = req.auth!.userId;
    const ownerId = acceptRequest(me, req.params.id);
    if (!ownerId) {
      res.status(404).json({ error: "Request not found." });
      return;
    }
    emitContactsChanged(ownerId);
    void sendPushToUser(ownerId, {
      title: "Emergency contact added",
      body: `${nameOf(me)} accepted — they'll be alerted if you miss a check-in.`,
      url: "/checkins",
      tag: "contact-accepted",
    });
    res.json(getOverview(me));
  })
);

/** Decline a request, stop being someone's contact, or remove one of mine. */
contactsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const me = req.auth!.userId;
    const removed = removeLink(me, req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Not found." });
      return;
    }
    if (removed.other) emitContactsChanged(removed.other);
    res.json(getOverview(me));
  })
);
