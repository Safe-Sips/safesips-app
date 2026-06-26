import { config } from "../config.js";
import { db } from "../db.js";
import { genId, nowMs, randomToken, sha256 } from "../util.js";

const insertVerification = db.prepare(
  `INSERT INTO email_verifications (id, user_id, token_hash, purpose, expires_at, consumed_at, created_at)
   VALUES (@id, @user_id, @token_hash, @purpose, @expires_at, NULL, @created_at)`
);
const selectByHash = db.prepare(
  `SELECT * FROM email_verifications WHERE token_hash = ? AND purpose = ?`
);
const markConsumed = db.prepare(
  `UPDATE email_verifications SET consumed_at = ? WHERE id = ?`
);

interface VerificationRow {
  id: string;
  user_id: string;
  token_hash: string;
  purpose: string;
  expires_at: number;
  consumed_at: number | null;
  created_at: number;
}

/** Create a single-use verification token; only its sha256 is stored. */
export function createVerificationToken(
  userId: string,
  purpose = "verify"
): string {
  const raw = randomToken(32);
  const now = nowMs();
  insertVerification.run({
    id: genId(),
    user_id: userId,
    token_hash: sha256(raw),
    purpose,
    expires_at: now + config.emailTokenTtlHours * 3_600_000,
    created_at: now,
  });
  return raw;
}

export function buildVerifyUrl(rawToken: string): string {
  const base = config.webAppUrl.replace(/\/+$/, "");
  return `${base}/verify?token=${encodeURIComponent(rawToken)}`;
}

/**
 * "Send" a verification email. In development the link is logged so testing
 * works without a mailbox. In production this is the seam for an SMTP provider;
 * the raw token is never logged there.
 */
export function sendVerificationEmail(to: string, rawToken: string): void {
  if (!config.isProduction) {
    // eslint-disable-next-line no-console
    console.log(`[email:dev] verification link for ${to}: ${buildVerifyUrl(rawToken)}`);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[email] verification email queued for ${to}`);
  // TODO: integrate SMTP (nodemailer) here using SMTP_* env vars.
}

export interface ConsumeResult {
  ok: boolean;
  userId?: string;
  reason?: "invalid" | "used" | "expired";
}

/** Validate + single-use consume a verification token. */
export function consumeVerificationToken(
  rawToken: string,
  purpose = "verify"
): ConsumeResult {
  const row = selectByHash.get(sha256(rawToken), purpose) as
    | VerificationRow
    | undefined;
  if (!row) return { ok: false, reason: "invalid" };
  if (row.consumed_at != null) return { ok: false, reason: "used" };
  if (row.expires_at <= nowMs()) return { ok: false, reason: "expired" };
  markConsumed.run(nowMs(), row.id);
  return { ok: true, userId: row.user_id };
}
