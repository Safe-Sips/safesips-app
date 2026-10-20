import type { CheckinAlertDTO, LatLng } from "@safesips/shared";
import { db } from "../db.js";
import { genId, nowMs } from "../util.js";

/** In-app alerts a contact received because someone missed a check-in. */

const insertAlert = db.prepare(
  `INSERT INTO checkin_alerts (id, occurrence_id, owner_id, contact_user_id, plan_label, area_lat, area_lng, created_at)
   VALUES (@id, @occurrence_id, @owner_id, @contact_user_id, @plan_label, @area_lat, @area_lng, @created_at)`
);
const listForContact = db.prepare(
  `SELECT a.id, a.occurrence_id, a.plan_label, a.area_lat, a.area_lng, a.created_at, a.acknowledged_at,
          o.display_name AS owner_name
     FROM checkin_alerts a JOIN users o ON o.id = a.owner_id
    WHERE a.contact_user_id = ? ORDER BY a.created_at DESC LIMIT ?`
);
const othersOnIt = db.prepare(
  `SELECT u.display_name FROM checkin_alerts a JOIN users u ON u.id = a.contact_user_id
    WHERE a.occurrence_id = ? AND a.contact_user_id != ? AND a.acknowledged_at IS NOT NULL`
);
const ackStmt = db.prepare(
  `UPDATE checkin_alerts SET acknowledged_at = ? WHERE id = ? AND contact_user_id = ? AND acknowledged_at IS NULL`
);
const alertOwner = db.prepare(
  `SELECT owner_id, occurrence_id FROM checkin_alerts WHERE id = ? AND contact_user_id = ?`
);
const unread = db.prepare(
  `SELECT COUNT(*) AS c FROM checkin_alerts WHERE contact_user_id = ? AND acknowledged_at IS NULL`
);

export function createAlert(input: {
  occurrenceId: string;
  ownerId: string;
  contactUserId: string;
  planLabel: string | null;
  area: LatLng | null;
}): string {
  const id = genId();
  insertAlert.run({
    id,
    occurrence_id: input.occurrenceId,
    owner_id: input.ownerId,
    contact_user_id: input.contactUserId,
    plan_label: input.planLabel,
    area_lat: input.area?.lat ?? null,
    area_lng: input.area?.lng ?? null,
    created_at: nowMs(),
  });
  return id;
}

export function listAlerts(contactUserId: string, limit = 50): CheckinAlertDTO[] {
  const rows = listForContact.all(contactUserId, limit) as Array<{
    id: string;
    occurrence_id: string;
    plan_label: string | null;
    area_lat: number | null;
    area_lng: number | null;
    created_at: number;
    acknowledged_at: number | null;
    owner_name: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    ownerDisplayName: r.owner_name,
    planLabel: r.plan_label,
    area: r.area_lat !== null && r.area_lng !== null ? { lat: r.area_lat, lng: r.area_lng } : null,
    createdAt: r.created_at,
    acknowledgedAt: r.acknowledged_at,
    othersOnIt: (othersOnIt.all(r.occurrence_id, contactUserId) as Array<{ display_name: string }>).map(
      (o) => o.display_name
    ),
  }));
}

/** Mark "I'm checking on them". Returns the owner's id the first time, else null. */
export function acknowledgeAlert(contactUserId: string, alertId: string): { ownerId: string } | null {
  const row = alertOwner.get(alertId, contactUserId) as { owner_id: string } | undefined;
  if (!row) return null;
  return ackStmt.run(nowMs(), alertId, contactUserId).changes > 0 ? { ownerId: row.owner_id } : null;
}

export function unreadAlertCount(contactUserId: string): number {
  return (unread.get(contactUserId) as { c: number }).c;
}
