import nodemailer, { type Transporter } from "nodemailer";
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

/** Lazily-created SMTP transport (null when SMTP isn't configured). */
let transporter: Transporter | null = null;
let transporterInit = false;

function getTransporter(): Transporter | null {
  if (transporterInit) return transporter;
  transporterInit = true;
  if (!config.smtp) return null;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: config.smtp.user
      ? { user: config.smtp.user, pass: config.smtp.pass }
      : undefined,
  });
  return transporter;
}

function verificationEmailHtml(url: string): string {
  return `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
    <h1 style="font-size:22px;margin:0 0 8px">Welcome to SafeSips</h1>
    <p style="font-size:15px;line-height:1.5;color:#444">
      Confirm your email to start using the live safety map, reports, and the community forum.
    </p>
    <p style="margin:24px 0">
      <a href="${url}" style="background:#ffd400;color:#1a1700;text-decoration:none;font-weight:700;padding:12px 20px;border-radius:10px;display:inline-block">
        Verify my email
      </a>
    </p>
    <p style="font-size:13px;color:#666;line-height:1.5">
      Or paste this link into your browser:<br>
      <a href="${url}" style="color:#0a58ca;word-break:break-all">${url}</a>
    </p>
    <p style="font-size:12px;color:#999;margin-top:24px">
      If you didn't create a SafeSips account, you can safely ignore this email.
    </p>
  </div>`;
}

/**
 * Send a verification email. Uses SMTP when configured; otherwise logs the link
 * (dev) so testing works without a mailbox. Never throws — a mail failure must
 * not break registration (the user can request a new link).
 */
export async function sendVerificationEmail(
  to: string,
  rawToken: string
): Promise<void> {
  const url = buildVerifyUrl(rawToken);
  const tx = getTransporter();

  if (!tx) {
    if (!config.isProduction) {
      // eslint-disable-next-line no-console
      console.log(`[email:dev] verification link for ${to}: ${url}`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[email] SMTP not configured — cannot send verification to ${to}`);
    }
    return;
  }

  try {
    await tx.sendMail({
      from: config.emailFrom,
      to,
      subject: "Verify your SafeSips email",
      text:
        `Welcome to SafeSips!\n\n` +
        `Confirm your email by opening this link:\n${url}\n\n` +
        `If you didn't sign up, you can ignore this message.`,
      html: verificationEmailHtml(url),
    });
    // eslint-disable-next-line no-console
    console.log(`[email] verification sent to ${to}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[email] failed to send verification to ${to}:`, err);
  }
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
