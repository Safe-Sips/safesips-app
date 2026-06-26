import { config } from "./config.js";
import { db } from "./db.js";
import { genId, nowMs } from "./util.js";

export interface NotifyContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

const insertEscalation = db.prepare(
  `INSERT INTO checkin_escalations (id, occurrence_id, contact_id, channel, status, detail, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`
);

/**
 * Escalation notifier stub. Today it records the escalation and logs it; this
 * is the seam for SMS/email integration later (branch on SMTP_ / SMS_ env).
 *
 * Crucially this is fully server-side, so a missed check-in escalates even if
 * the user's app is closed.
 */
export function notifyContact(
  occurrenceId: string,
  contact: NotifyContact | null,
  message: string
): void {
  const channel = "log";
  let status: "sent" | "failed" = "sent";
  let detail: string;

  if (!contact) {
    status = "failed";
    detail = "No primary SOS contact configured.";
    // eslint-disable-next-line no-console
    console.warn(`[sos] missed check-in but no SOS contact for occurrence ${occurrenceId}`);
  } else {
    const dest = contact.email ?? contact.phone ?? "no contact channel";
    detail = `${contact.name} <${dest}>`;
    if (!config.isProduction) {
      // eslint-disable-next-line no-console
      console.log(`[sos:dev] ${message} → ${detail}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`[sos] escalation recorded for occurrence ${occurrenceId}`);
    }
    // TODO: send real SMS/email here when SMTP_*/SMS_* are configured.
  }

  insertEscalation.run(genId(), occurrenceId, contact?.id ?? null, channel, status, detail, nowMs());
}
