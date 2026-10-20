import { EMERGENCY_NUMBER } from "@safesips/shared";
import { config } from "./config.js";
import { db } from "./db.js";
import { getMailTransport } from "./mailer.js";
import { genId, nowMs } from "./util.js";

export interface NotifyContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/** Who missed which check-in — what the contact needs to act. */
export interface EscalationContext {
  occurrenceId: string;
  /** Display name of the person who missed the check-in. */
  personName: string;
  planLabel: string | null;
}

export interface EscalationResult {
  channel: "email" | "sms" | "none";
  status: "sent" | "failed";
  detail: string;
}

const insertEscalation = db.prepare(
  `INSERT INTO checkin_escalations (id, occurrence_id, contact_id, channel, status, detail, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildEscalationEmail(ctx: EscalationContext): {
  subject: string;
  text: string;
  html: string;
} {
  const label = ctx.planLabel ? ` ("${ctx.planLabel}")` : "";
  const subject = `SafeSips: ${ctx.personName} missed a safety check-in`;
  const text =
    `${ctx.personName} set up a SafeSips safety check-in${label} and did not answer it in time.\n\n` +
    `They added you as their emergency contact. Please try to reach them now.\n\n` +
    `If you can't reach them and think they may be in danger, call ${EMERGENCY_NUMBER}.\n\n` +
    `SafeSips is not an emergency service. This alert was sent automatically.`;
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(ctx.personName)} missed a safety check-in</h1>
    <p style="font-size:15px;line-height:1.5">
      ${escapeHtml(ctx.personName)} set up a SafeSips safety check-in${escapeHtml(label)}
      and did not answer it in time. They added you as their emergency contact.
    </p>
    <p style="font-size:16px;line-height:1.5;font-weight:700">Please try to reach them now.</p>
    <p style="font-size:15px;line-height:1.5">
      If you can't reach them and think they may be in danger, call
      <strong>${EMERGENCY_NUMBER}</strong>.
    </p>
    <p style="font-size:12px;color:#777;margin-top:24px">
      SafeSips is not an emergency service. This alert was sent automatically.
    </p>
  </div>`;
  return { subject, text, html };
}

async function deliver(
  ctx: EscalationContext,
  contact: NotifyContact | null
): Promise<EscalationResult> {
  if (!contact) {
    return { channel: "none", status: "failed", detail: "No primary SOS contact configured." };
  }
  if (!contact.email) {
    // A phone-only contact can't be alerted: there is no SMS provider yet.
    return { channel: "sms", status: "failed", detail: "SMS alerts are not supported yet." };
  }
  const tx = getMailTransport();
  if (!tx) {
    return {
      channel: "email",
      status: "failed",
      detail: "Email delivery is not configured on this server (SMTP_HOST unset).",
    };
  }
  try {
    const mail = buildEscalationEmail(ctx);
    await tx.sendMail({ from: config.emailFrom, to: contact.email, ...mail });
    return { channel: "email", status: "sent", detail: `Emailed ${contact.name}.` };
  } catch (err) {
    return {
      channel: "email",
      status: "failed",
      detail: `Email send failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Alert the primary SOS contact that a check-in was missed, and record the
 * real outcome in checkin_escalations. Fully server-side, so it fires even if
 * the user's app is closed. Never throws.
 *
 * Email is sent via SMTP. SMS has no provider yet, so phone-only contacts are
 * recorded as a failed delivery rather than silently "sent".
 */
export async function notifyContact(
  ctx: EscalationContext,
  contact: NotifyContact | null
): Promise<EscalationResult> {
  const result = await deliver(ctx, contact);
  if (result.status === "failed") {
    // eslint-disable-next-line no-console
    console.error(`[sos] escalation NOT delivered for occurrence ${ctx.occurrenceId}: ${result.detail}`);
  } else {
    // eslint-disable-next-line no-console
    console.log(`[sos] escalation delivered for occurrence ${ctx.occurrenceId} via ${result.channel}`);
  }
  try {
    insertEscalation.run(
      genId(),
      ctx.occurrenceId,
      contact?.id ?? null,
      result.channel,
      result.status,
      result.detail,
      nowMs()
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sos] failed to record escalation:", err);
  }
  return result;
}
