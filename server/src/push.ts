import webpush from "web-push";
import { config } from "./config.js";
import { db } from "./db.js";
import { genId, nowMs } from "./util.js";

/**
 * Web Push notifications (check-in prompts, missed-check-in alerts) through
 * the browsers' push services. Works on Android/desktop browsers, and on
 * iPhone once SafeSips is added to the Home Screen (iOS 16.4+).
 *
 * VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY if set, otherwise generated
 * once and kept in app_settings — no setup needed. (If the database is reset,
 * new keys are made and devices simply re-subscribe on their next visit.)
 */

export interface PushPayload {
  title: string;
  body: string;
  /** Path to open when the notification is tapped, e.g. "/alerts". */
  url: string;
  /** Same tag = replaces the previous notification instead of stacking. */
  tag?: string;
  /** Keep it on screen until the user acts (urgent safety alerts). */
  requireInteraction?: boolean;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Sends one notification; resolves on success, rejects with {statusCode}. */
export type PushSender = (sub: PushSubscriptionInput, payload: string, urgent: boolean) => Promise<void>;

const getSetting = db.prepare(`SELECT value FROM app_settings WHERE key = ?`);
const putSetting = db.prepare(
  `INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING`
);
const upsertSub = db.prepare(
  `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at)
   VALUES (@id, @user_id, @endpoint, @p256dh, @auth, @created_at)
   ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
);
const deleteSubByEndpoint = db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`);
const deleteSubForUser = db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?`);
const subsForUser = db.prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`);

let vapid: { publicKey: string; privateKey: string } | null = null;

/**
 * VAPID "subject": a contact for push services. It must be an https: URL or
 * a mailto: address (push services reject anything else, and Apple rejects
 * localhost), so fall back to a mailto: when the web app URL isn't https.
 */
function vapidSubject(): string {
  const explicit = process.env.VAPID_SUBJECT?.trim();
  if (explicit) return explicit;
  try {
    const url = new URL(config.webAppUrl);
    if (url.protocol === "https:" && url.hostname !== "localhost") return url.origin;
  } catch {
    /* not a URL */
  }
  return "mailto:safesipss@gmail.com";
}

function vapidKeys(): { publicKey: string; privateKey: string } {
  if (vapid) return vapid;
  let keys: { publicKey: string; privateKey: string };
  const envPub = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPriv = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPub && envPriv) {
    keys = { publicKey: envPub, privateKey: envPriv };
  } else {
    const stored = getSetting.get("vapid") as { value: string } | undefined;
    if (!stored) {
      putSetting.run("vapid", JSON.stringify(webpush.generateVAPIDKeys()));
    }
    // Re-read in case another process won the race.
    keys = JSON.parse((getSetting.get("vapid") as { value: string }).value);
  }
  // Only cache once web-push accepted them — otherwise every later send would
  // silently go out unsigned (and be rejected by the push service).
  webpush.setVapidDetails(vapidSubject(), keys.publicKey, keys.privateKey);
  vapid = keys;
  return vapid;
}

/** The public key browsers need to subscribe. */
export function pushPublicKey(): string {
  return vapidKeys().publicKey;
}

let sender: PushSender = async (sub, payload, urgent) => {
  vapidKeys();
  await webpush.sendNotification(sub, payload, {
    TTL: urgent ? 2 * 60 * 60 : 15 * 60,
    urgency: urgent ? "high" : "normal",
  });
};

/** Tests replace the sender. */
export function setPushSender(s: PushSender): void {
  sender = s;
}

export function saveSubscription(userId: string, sub: PushSubscriptionInput): void {
  upsertSub.run({
    id: genId(),
    user_id: userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys.p256dh,
    auth: sub.keys.auth,
    created_at: nowMs(),
  });
}

export function removeSubscription(userId: string, endpoint: string): void {
  deleteSubForUser.run(endpoint, userId);
}

export function hasPushSubscription(userId: string): boolean {
  return subsForUser.all(userId).length > 0;
}

/**
 * Notify every device the user subscribed. Never throws. Subscriptions the
 * push service reports as gone (404/410) are deleted.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  urgent = false
): Promise<{ sent: number; failed: number }> {
  const subs = subsForUser.all(userId) as Array<{ endpoint: string; p256dh: string; auth: string }>;
  let sent = 0;
  let failed = 0;
  const body = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, urgent);
        sent++;
      } catch (err) {
        failed++;
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) deleteSubByEndpoint.run(s.endpoint);
        else {
          // eslint-disable-next-line no-console
          console.warn("[push] send failed:", status ?? (err instanceof Error ? err.message : err));
        }
      }
    })
  );
  return { sent, failed };
}
