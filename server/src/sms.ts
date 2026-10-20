import { config } from "./config.js";
import { db } from "./db.js";
import { hashIdentifier } from "./privacyHash.js";
import { genId, nowMs } from "./util.js";

/**
 * Text messages for SOS alerts, sent either
 *  - from your own Android phone + SIM via the "SMS Gateway for Android" app
 *    (sms-gate.app) and its cloud relay, or
 *  - through Twilio's REST API.
 * Each is one HTTPS request (no SDK). Off unless one is configured — callers
 * then record an honest "not configured" failure instead of pretending.
 */

export type SmsKind = "alert" | "test";

/** A failed send; `retryable` = worth trying again (network, 429, 5xx). */
export class SmsError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export interface SmsTransport {
  /**
   * Resolves when the provider accepted the message (optionally with a status
   * note for the user); throws SmsError otherwise. `urgent` = a real SOS alert.
   */
  send(to: string, body: string, opts?: { urgent: boolean }): Promise<string | void>;
}

/** HTTP status → SmsError, retrying only what can succeed later. */
async function providerError(res: Response, name: string): Promise<SmsError> {
  let detail = `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { code?: number | string; message?: string };
    detail = [detail, j.code, j.message].filter(Boolean).join(" ");
  } catch {
    /* non-JSON error body */
  }
  return new SmsError(
    `${name} rejected the message (${detail}).`,
    res.status === 429 || res.status >= 500
  );
}

/**
 * Your own phone: "SMS Gateway for Android" cloud API.
 * POST {base}/messages, Basic auth (username/password from the app's Home tab),
 * body { phoneNumbers, textMessage: { text }, ttl, priority }; 202 = queued.
 */
function androidGatewayTransport(cfg: NonNullable<typeof config.smsGateway>): SmsTransport {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/messages`;
  const auth = `Basic ${Buffer.from(`${cfg.username}:${cfg.password}`).toString("base64")}`;
  return {
    async send(to, body, opts) {
      const urgent = opts?.urgent ?? false;
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify({
            phoneNumbers: [to],
            textMessage: { text: body },
            // If the phone is offline, don't deliver a stale SOS hours later.
            ttl: urgent ? 2 * 60 * 60 : 10 * 60,
            // >= 100 skips the app's own send-rate limiting for real alerts.
            priority: urgent ? 100 : 0,
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new SmsError(
          `Couldn't reach the SMS gateway: ${err instanceof Error ? err.message : String(err)}`,
          true
        );
      }
      if (res.ok) return "Text queued on your SafeSips phone.";
      throw await providerError(res, "The phone SMS gateway");
    },
  };
}

function twilioTransport(cfg: NonNullable<typeof config.twilio>): SmsTransport {
  const url = `${cfg.apiBase.replace(/\/+$/, "")}/2010-04-01/Accounts/${encodeURIComponent(
    cfg.accountSid
  )}/Messages.json`;
  const auth = `Basic ${Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString("base64")}`;
  return {
    async send(to, body) {
      const params = new URLSearchParams({ To: to, Body: body });
      if (cfg.messagingServiceSid) params.set("MessagingServiceSid", cfg.messagingServiceSid);
      else params.set("From", cfg.from ?? "");
      let res: Response;
      try {
        res = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: auth,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        throw new SmsError(
          `Couldn't reach the SMS provider: ${err instanceof Error ? err.message : String(err)}`,
          true
        );
      }
      if (res.ok) return;
      throw await providerError(res, "The SMS provider");
    },
  };
}

let transport: SmsTransport | null = null;
let transportInit = false;

function getSmsTransport(): SmsTransport | null {
  if (transportInit) return transport;
  transportInit = true;
  const wantTwilio = config.smsProvider === "twilio";
  const wantAndroid = config.smsProvider === "android";
  if (config.smsGateway && !wantTwilio) transport = androidGatewayTransport(config.smsGateway);
  else if (config.twilio && !wantAndroid) transport = twilioTransport(config.twilio);
  else transport = null;
  return transport;
}

/** True when text alerts can actually be sent. */
export function isSmsConfigured(): boolean {
  return getSmsTransport() !== null;
}

/** Replace the transport (tests use a fake or a local mock Twilio). */
export function setSmsTransport(t: SmsTransport | null): void {
  transport = t;
  transportInit = true;
}

let retryDelaysMs = [0, 3_000, 10_000];
/** Tests shorten the retry back-off. */
export function setSmsRetryDelays(delays: number[]): void {
  retryDelaysMs = delays;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const countSent = db.prepare(
  `SELECT COUNT(*) AS c FROM sms_sends WHERE status = 'sent' AND created_at > ?`
);
const countSentTo = db.prepare(
  `SELECT COUNT(*) AS c FROM sms_sends WHERE status = 'sent' AND to_hash = ? AND created_at > ?`
);
const countUserTests = db.prepare(
  `SELECT COUNT(*) AS c FROM sms_sends WHERE user_id = ? AND kind = 'test' AND created_at > ?`
);
const insertSend = db.prepare(
  `INSERT INTO sms_sends (id, user_id, to_hash, kind, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`
);
const c = (row: unknown) => (row as { c: number }).c;

/** Best-effort: a logging failure must never turn a sent alert into an error. */
function logSend(userId: string, toHash: string, kind: SmsKind, status: "sent" | "failed"): void {
  try {
    insertSend.run(genId(), userId, toHash, kind, status, nowMs());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sms] failed to log send:", err);
  }
}

export interface SmsResult {
  ok: boolean;
  detail: string;
}

/**
 * Send one text, enforcing the cost/abuse limits and retrying transient
 * failures. Never throws.
 *  - a global daily cap (SMS_DAILY_LIMIT),
 *  - a per-number daily cap (SMS_MAX_PER_NUMBER_PER_DAY) so nobody can use
 *    check-ins to spam a stranger's phone,
 *  - a per-user daily cap on test messages (SMS_TESTS_PER_USER_PER_DAY).
 */
export async function sendSms(opts: {
  to: string;
  body: string;
  userId: string;
  kind: SmsKind;
}): Promise<SmsResult> {
  const t = getSmsTransport();
  if (!t) {
    return { ok: false, detail: "Text alerts aren't set up on this server yet." };
  }
  const since = nowMs() - DAY_MS;
  const toHash = hashIdentifier(opts.to);
  if (c(countSent.get(since)) >= config.smsDailyLimit) {
    return { ok: false, detail: "The daily text limit for SafeSips has been reached." };
  }
  if (c(countSentTo.get(toHash, since)) >= config.smsMaxPerNumberPerDay) {
    return { ok: false, detail: "This number has already had the most texts allowed today." };
  }
  if (opts.kind === "test" && c(countUserTests.get(opts.userId, since)) >= config.smsTestsPerUserPerDay) {
    return { ok: false, detail: "You've used today's test texts. Try again tomorrow." };
  }

  let lastError = "Unknown error.";
  for (const delay of retryDelaysMs) {
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));
    try {
      const note = await t.send(opts.to, opts.body, { urgent: opts.kind === "alert" });
      logSend(opts.userId, toHash, opts.kind, "sent");
      return { ok: true, detail: note || "Text sent." };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (!(err instanceof SmsError) || !err.retryable) break;
    }
  }
  logSend(opts.userId, toHash, opts.kind, "failed");
  return { ok: false, detail: lastError };
}
