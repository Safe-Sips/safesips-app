import { EMERGENCY_NUMBER, type LatLng } from "@safesips/shared";
import { config } from "./config.js";
import { db } from "./db.js";
import { getMailTransport } from "./mailer.js";
import { sendPushToUser } from "./push.js";
import { emitAlertNew } from "./realtime.js";
import { createAlert } from "./repos/alerts.js";
import { listAcceptedContacts } from "./repos/emergencyContacts.js";
import { genId, nowMs } from "./util.js";

/**
 * Check-in notifications, all inside SafeSips:
 *  - due:    the person checking in gets a push notification to answer;
 *  - missed: every accepted emergency contact (another SafeSips user) gets an
 *            alert in their in-app inbox, a live in-app nudge if they're
 *            online, and a push notification — plus an email to their account
 *            address if SMTP is configured.
 */

/** Who missed which check-in — what a contact needs to act. */
export interface EscalationContext {
  occurrenceId: string;
  userId: string;
  /** Display name of the person who missed the check-in. */
  personName: string;
  planLabel: string | null;
  /**
   * Their last shared area if they were sharing at that moment: the already
   * masked circle centre other users see, never the exact position.
   */
  area: LatLng | null;
}

export interface EscalationSummary {
  /** Contacts who got an in-app alert. */
  contacts: number;
  /** Contacts reached on at least one device by push. */
  pushed: number;
  emailed: number;
}

const insertEscalation = db.prepare(
  `INSERT INTO checkin_escalations (id, occurrence_id, contact_id, channel, status, detail, created_at)
   VALUES (?, ?, NULL, ?, ?, ?, ?)`
);

function record(occurrenceId: string, channel: string, status: "sent" | "failed", detail: string): void {
  try {
    insertEscalation.run(genId(), occurrenceId, channel, status, detail, nowMs());
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[sos] failed to record escalation:", err);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** OpenStreetMap link to an (approximate, masked) area. */
export function areaLink(area: LatLng): string {
  const lat = area.lat.toFixed(4);
  const lng = area.lng.toFixed(4);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

/** The push notification a contact gets for a missed check-in. */
export function buildAlertPush(ctx: EscalationContext): { title: string; body: string } {
  const label = ctx.planLabel ? ` ("${ctx.planLabel}")` : "";
  return {
    title: `${ctx.personName} missed a safety check-in`,
    body:
      `They didn't answer their SafeSips check-in${label}. Please try to reach them now. ` +
      `Open SafeSips to see where they were last sharing.`,
  };
}

export function buildEscalationEmail(ctx: EscalationContext): {
  subject: string;
  text: string;
  html: string;
} {
  const label = ctx.planLabel ? ` ("${ctx.planLabel}")` : "";
  const subject = `SafeSips: ${ctx.personName} missed a safety check-in`;
  const appLink = `${config.webAppUrl.replace(/\/+$/, "")}/alerts`;
  const whereText = ctx.area
    ? `Their last shared area (approximate): ${areaLink(ctx.area)}\n\n`
    : "";
  const text =
    `${ctx.personName} did not answer their SafeSips safety check-in${label} in time.\n\n` +
    `You're one of their emergency contacts. Please try to reach them now.\n\n` +
    whereText +
    `See the alert in SafeSips: ${appLink}\n\n` +
    `If you can't reach them and think they may be in danger, call ${EMERGENCY_NUMBER}.\n\n` +
    `SafeSips is not an emergency service.`;
  const whereHtml = ctx.area
    ? `<p style="font-size:15px;line-height:1.5">Their last shared area (approximate):
       <a href="${areaLink(ctx.area)}" style="color:#0a58ca">open map</a></p>`
    : "";
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(ctx.personName)} missed a safety check-in</h1>
    <p style="font-size:15px;line-height:1.5">
      ${escapeHtml(ctx.personName)} did not answer their SafeSips check-in${escapeHtml(label)} in time.
      You're one of their emergency contacts.
    </p>
    <p style="font-size:16px;line-height:1.5;font-weight:700">Please try to reach them now.</p>
    ${whereHtml}
    <p style="font-size:15px;line-height:1.5"><a href="${appLink}" style="color:#0a58ca">Open the alert in SafeSips</a></p>
    <p style="font-size:15px;line-height:1.5">
      If you can't reach them and think they may be in danger, call <strong>${EMERGENCY_NUMBER}</strong>.
    </p>
    <p style="font-size:12px;color:#777;margin-top:24px">SafeSips is not an emergency service.</p>
  </div>`;
  return { subject, text, html };
}

/** A check-in is due: notify the person (all their devices). Never throws. */
export async function promptCheckin(userId: string, occurrenceId: string, deadlineAt: number): Promise<void> {
  const minutes = Math.max(1, Math.round((deadlineAt - nowMs()) / 60_000));
  await sendPushToUser(
    userId,
    {
      title: "SafeSips check-in",
      body: `Time to check in. Answer within ${minutes} min, or your emergency contacts will be alerted.`,
      url: "/checkins",
      tag: `checkin-${occurrenceId}`,
      requireInteraction: true,
    },
    true
  );
}

/**
 * A check-in was missed: alert every accepted emergency contact and record
 * each outcome in checkin_escalations. Fully server-side (works even if the
 * person's app is closed). Never throws.
 */
export async function alertEmergencyContacts(ctx: EscalationContext): Promise<EscalationSummary> {
  const contacts = listAcceptedContacts(ctx.userId);
  const summary: EscalationSummary = { contacts: 0, pushed: 0, emailed: 0 };
  if (contacts.length === 0) {
    record(ctx.occurrenceId, "none", "failed", "No accepted emergency contacts.");
    // eslint-disable-next-line no-console
    console.error(`[sos] occurrence ${ctx.occurrenceId}: NOBODY to alert (no accepted contacts)`);
    return summary;
  }

  const push = buildAlertPush(ctx);
  const mail = getMailTransport();
  await Promise.all(
    contacts.map(async (c) => {
      try {
        const alertId = createAlert({
          occurrenceId: ctx.occurrenceId,
          ownerId: ctx.userId,
          contactUserId: c.id,
          planLabel: ctx.planLabel,
          area: ctx.area,
        });
        summary.contacts++;
        record(ctx.occurrenceId, "inapp", "sent", `In-app alert ${alertId}.`);
        emitAlertNew(c.id, { alertId, ownerDisplayName: ctx.personName });

        const p = await sendPushToUser(
          c.id,
          { ...push, url: "/alerts", tag: `alert-${ctx.occurrenceId}`, requireInteraction: true },
          true
        );
        if (p.sent > 0) summary.pushed++;
        record(
          ctx.occurrenceId,
          "push",
          p.sent > 0 ? "sent" : "failed",
          p.sent + p.failed === 0
            ? "Contact hasn't turned on notifications."
            : `Push: ${p.sent} sent, ${p.failed} failed.`
        );

        if (mail && c.email) {
          try {
            await mail.sendMail({ from: config.emailFrom, to: c.email, ...buildEscalationEmail(ctx) });
            summary.emailed++;
            record(ctx.occurrenceId, "email", "sent", "Email sent.");
          } catch (err) {
            record(ctx.occurrenceId, "email", "failed", `Email failed: ${err instanceof Error ? err.message : err}`);
          }
        }
      } catch (err) {
        record(ctx.occurrenceId, "inapp", "failed", `Alert failed: ${err instanceof Error ? err.message : err}`);
      }
    })
  );
  // eslint-disable-next-line no-console
  console.log(
    `[sos] occurrence ${ctx.occurrenceId}: alerted ${summary.contacts} contact(s), push reached ${summary.pushed}, emailed ${summary.emailed}`
  );
  return summary;
}
