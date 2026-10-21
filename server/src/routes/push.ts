import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { config } from "../config.js";
import { pushPublicKey, removeSubscription, saveSubscription } from "../push.js";

/** Register this browser/device for SafeSips notifications. */
export const pushRouter = Router();
pushRouter.use(requireAuth);

pushRouter.get(
  "/public-key",
  asyncHandler(async (_req, res) => {
    res.json({ publicKey: pushPublicKey() });
  })
);

/**
 * Browser push services. The server POSTs to whatever endpoint a device
 * registers, so only accept these (no making the server call arbitrary URLs).
 */
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "push.services.mozilla.com",
  "push.apple.com",
  "notify.windows.com",
];

export function isPushServiceEndpoint(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    return PUSH_HOST_SUFFIXES.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Local end-to-end tests point devices at a mock push service.
const allowAnyHttpsEndpoint = config.allowTestToken;

const subscriptionSchema = z.object({
  endpoint: z
    .string()
    .url()
    .max(2048)
    .refine((u) => u.startsWith("https://"), "Push endpoint must be HTTPS.")
    .refine((u) => allowAnyHttpsEndpoint || isPushServiceEndpoint(u), "That isn't a supported push service."),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

pushRouter.post(
  "/subscribe",
  asyncHandler(async (req, res) => {
    const body = parseBody(subscriptionSchema, req, res);
    if (!body) return;
    saveSubscription(req.auth!.userId, body);
    res.json({ ok: true });
  })
);

pushRouter.post(
  "/unsubscribe",
  asyncHandler(async (req, res) => {
    const body = parseBody(z.object({ endpoint: z.string().max(2048) }), req, res);
    if (!body) return;
    removeSubscription(req.auth!.userId, body.endpoint);
    res.json({ ok: true });
  })
);
