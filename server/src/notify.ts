import { EMERGENCY_NUMBER, normalizePhone, type LatLng } from "@safesips/shared";
import { config } from "./config.js";
import { db } from "./db.js";
import { getMailTransport } from "./mailer.js";
import { sendSms } from "./sms.js";
import { genId, nowMs } from "./util.js";

export interface NotifyContact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

/** Who missed which check-in — what a contact needs to act. */
export interface EscalationContext {
  occurrenceId: string;
  userId: string;
  /** Display name of the person who missed the check-in. */
  personName: string;
  planLabel: string | null;
  /**
   * The person's last shared area, if they were sharing their location when
   * the check-in was missed. This is the already-masked circle centre other
   * users see (never the exact position).
   */
  area: LatLng | null;
}

export interface EscalationResult {
  contactId: string | null;
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

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** OpenStreetMap link to an (approximate, masked) area. */
export function areaLink(area: LatLng): string {
  const lat = area.lat.toFixed(4);
  const lng = area.lng.toFixed(4);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;
}

/** Short alert text (one or two SMS segments). */
export function buildEscalationSms(ctx: EscalationContext): string {
  const name = clip(ctx.personName, 40);
  const label = ctx.planLabel ? ` ("${clip(ctx.planLabel, 30)}")` : "";
  const where = ctx.area ? ` Last shared area (approx.): ${areaLink(ctx.area)}` : "";
  return (
    `SafeSips alert: ${name} missed a safety check-in${label} and may need help. ` +
    `Please call them now. If you can't reach them, call ${EMERGENCY_NUMBER}.${where}`
  );
}

export function buildEscalationEmail(ctx: EscalationContext): {
  subject: string;
  text: string;
  html: string;
} {
  const label = ctx.planLabel ? ` ("${ctx.planLabel}")` : "";
  const subject = `SafeSips: ${ctx.personName} missed a safety check-in`;
  const whereText = ctx.area
    ? `Their last shared area (approximate, within a few hundred metres): ${areaLink(ctx.area)}\n\n`
    : "";
  const text =
    `${ctx.personName} set up a SafeSips safety check-in${label} and did not answer it in time.\n\n` +
    `They added you as their emergency contact. Please try to reach them now.\n\n` +
    whereText +
    `If you can't reach them and think they may be in danger, call ${EMERGENCY_NUMBER}.\n\n` +
    `SafeSips is not an emergency service. This alert was sent automatically.`;
  const whereHtml = ctx.area
    ? `<p style="font-size:15px;line-height:1.5">Their last shared area (approximate):
       <a href="${areaLink(ctx.area)}" style="color:#0a58ca">open map</a></p>`
    : "";
  const html = `
  <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1a1a">
    <h1 style="font-size:20px;margin:0 0 12px">${escapeHtml(ctx.personName)} missed a safety check-in</h1>
    <p style="font-size:15px;line-height:1.5">
      ${escapeHtml(ctx.personName)} set up a SafeSips safety check-in${escapeHtml(label)}
      and did not answer it in time. They added you as their emergency contact.
    </p>
    <p style="font-size:16px;line-height:1.5;font-weight:700">Please try to reach them now.</p>
    ${whereHtml}
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

/** The test message a user can send to check a contact will get alerts. */
export function buildTestSms(personName: string): string {
  return (
    `SafeSips: ${clip(personName, 40)} added you as an emergency contact. ` +
    `If they miss a safety check-in, you'll get an alert here. This is a test - no action needed.`
  );
}

async function sendEmail(
  to: string,
  mail: { subject: string; text: string; html: string }
): Promise<{ ok: boolean; detail: string }> {
  const tx = getMailTransport();
  if (!tx) return { ok: false, detail: "Email alerts aren't set up on this server yet." };
  try {
    await tx.sendMail({ from: config.emailFrom, to, ...mail });
    return { ok: true, detail: "Email sent." };
  } catch (err) {
    return {
      ok: false,
      detail: `Email send failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Every channel a contact can be reached on, with its normalised address. */
function channelsFor(contact: NotifyContact): Array<
  { channel: "sms"; to: string } | { channel: "email"; to: string } | { channel: "sms-invalid" }
> {
  const out: ReturnType<typeof channelsFor> = [];
  if (contact.phone) {
    const to = normalizePhone(contact.phone);
    out.push(to ? { channel: "sms", to } : { channel: "sms-invalid" });
  }
  if (contact.email) out.push({ channel: "email", to: contact.email });
  return out;
}

/** Alert one contact on all of their channels. Never throws. */
export async function alertContact(
  ctx: EscalationContext,
  contact: NotifyContact
): Promise<EscalationResult[]> {
  const results: EscalationResult[] = [];
  const channels = channelsFor(contact);
  if (channels.length === 0) {
    results.push({ contactId: contact.id, channel: "none", status: "failed", detail: "Contact has no phone or email." });
  }
  for (const ch of channels) {
    if (ch.channel === "sms-invalid") {
      results.push({ contactId: contact.id, channel: "sms", status: "failed", detail: "Phone number isn't valid." });
    } else if (ch.channel === "sms") {
      const r = await sendSms({ to: ch.to, body: buildEscalationSms(ctx), userId: ctx.userId, kind: "alert" });
      results.push({ contactId: contact.id, channel: "sms", status: r.ok ? "sent" : "failed", detail: r.detail });
    } else {
      const r = await sendEmail(ch.to, buildEscalationEmail(ctx));
      results.push({ contactId: contact.id, channel: "email", status: r.ok ? "sent" : "failed", detail: r.detail });
    }
  }
  return results;
}

/**
 * A check-in was missed: alert ALL of the user's emergency contacts, on every
 * channel each one has (text and/or email), and record every attempt's real
 * outcome in checkin_escalations. Fully server-side, so it fires even if the
 * user's app is closed. Never throws.
 */
export async function notifyContacts(
  ctx: EscalationContext,
  contacts: NotifyContact[]
): Promise<EscalationResult[]> {
  const results: EscalationResult[] =
    contacts.length === 0
      ? [{ contactId: null, channel: "none", status: "failed", detail: "No emergency contacts configured." }]
      : (await Promise.all(contacts.map((c) => alertContact(ctx, c)))).flat();

  const delivered = results.some((r) => r.status === "sent");
  // eslint-disable-next-line no-console
  (delivered ? console.log : console.error)(
    `[sos] occurrence ${ctx.occurrenceId}: ${results
      .map((r) => `${r.channel}=${r.status}`)
      .join(", ")}${delivered ? "" : " — NOBODY was alerted"}`
  );
  for (const r of results) {
    try {
      insertEscalation.run(genId(), ctx.occurrenceId, r.contactId, r.channel, r.status, r.detail, nowMs());
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[sos] failed to record escalation:", err);
    }
  }
  return results;
}

/** Send a test alert to one contact so the user can check it arrives. */
export async function sendTestAlert(
  userId: string,
  personName: string,
  contact: NotifyContact
): Promise<Array<{ channel: "email" | "sms"; ok: boolean; detail: string }>> {
  const out: Array<{ channel: "email" | "sms"; ok: boolean; detail: string }> = [];
  for (const ch of channelsFor(contact)) {
    if (ch.channel === "sms-invalid") {
      out.push({ channel: "sms", ok: false, detail: "Phone number isn't valid." });
    } else if (ch.channel === "sms") {
      const r = await sendSms({ to: ch.to, body: buildTestSms(personName), userId, kind: "test" });
      out.push({ channel: "sms", ...r });
    } else {
      const r = await sendEmail(ch.to, {
        subject: `SafeSips: ${personName} added you as an emergency contact`,
        text: `${buildTestSms(personName)}\n\nSafeSips is not an emergency service.`,
        html: `<p>${escapeHtml(buildTestSms(personName))}</p><p style="color:#777;font-size:12px">SafeSips is not an emergency service.</p>`,
      });
      out.push({ channel: "email", ...r });
    }
  }
  return out;
}
