import { Router } from "express";
import { asyncHandler } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { sendPushToUser } from "../push.js";
import { acknowledgeAlert, listAlerts, unreadAlertCount } from "../repos/alerts.js";
import { findUserById } from "../repos/users.js";

/** Alerts I received as someone's emergency contact. */
export const alertsRouter = Router();
alertsRouter.use(requireAuth);

alertsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const me = req.auth!.userId;
    res.json({ alerts: listAlerts(me), unread: unreadAlertCount(me) });
  })
);

/** "I'm checking on them" — and let the person know someone is coming. */
alertsRouter.post(
  "/:id/ack",
  asyncHandler(async (req, res) => {
    const me = req.auth!.userId;
    const result = acknowledgeAlert(me, req.params.id);
    if (result) {
      const name = findUserById(me)?.display_name ?? "One of your emergency contacts";
      void sendPushToUser(result.ownerId, {
        title: "Someone is checking on you",
        body: `${name} saw that you missed your check-in and is checking on you.`,
        url: "/checkins",
        tag: "alert-ack",
      });
    }
    res.json({ alerts: listAlerts(me), unread: unreadAlertCount(me) });
  })
);
