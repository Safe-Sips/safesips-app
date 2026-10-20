import type { LatLng } from "@safesips/shared";
import { db } from "./db.js";
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
 *            online, and a push notification. (No email: alerts stay in SafeSips.)
 */

/** Who missed which check-in — what a contact needs to act. */
export interface EscalationContext {
  occurrenceId: string;
  userId: string;
  /**
   * The contacts this check-in should alert (account ids); empty = everyone.
   * Only accepted contacts are ever alerted.
   */
  selectedContactIds?: string[];
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
  const accepted = listAcceptedContacts(ctx.userId);
  const chosen = new Set(ctx.selectedContactIds ?? []);
  const picked = accepted.filter((c) => chosen.has(c.id));
  // If everyone picked for this check-in has since stopped being a contact,
  // alert the remaining contacts rather than nobody.
  const contacts = chosen.size > 0 && picked.length > 0 ? picked : accepted;
  const summary: EscalationSummary = { contacts: 0, pushed: 0 };
  if (contacts.length === 0) {
    record(ctx.occurrenceId, "none", "failed", "No accepted emergency contacts.");
    // eslint-disable-next-line no-console
    console.error(`[sos] occurrence ${ctx.occurrenceId}: NOBODY to alert (no accepted contacts)`);
    return summary;
  }

  const push = buildAlertPush(ctx);
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

      } catch (err) {
        record(ctx.occurrenceId, "inapp", "failed", `Alert failed: ${err instanceof Error ? err.message : err}`);
      }
    })
  );
  // eslint-disable-next-line no-console
  console.log(
    `[sos] occurrence ${ctx.occurrenceId}: alerted ${summary.contacts} contact(s), push reached ${summary.pushed}`
  );
  return summary;
}
