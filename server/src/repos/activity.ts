import type { ActivityDTO, ActivityKind } from "@safesips/shared";
import { db } from "../db.js";
import { genId, nowMs } from "../util.js";

const insert = db.prepare(
  `INSERT INTO activity_log (id, user_id, kind, ref_id, context, created_at)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const selectPage = db.prepare(
  `SELECT * FROM activity_log
   WHERE user_id = ? AND created_at < ?
   ORDER BY created_at DESC
   LIMIT ?`
);

export function logActivity(
  userId: string,
  kind: ActivityKind,
  refId: string | null,
  context: string | null = null
): void {
  insert.run(genId(), userId, kind, refId, context, nowMs());
}

export function listActivity(
  userId: string,
  before: number,
  limit: number
): ActivityDTO[] {
  const rows = selectPage.all(userId, before, limit) as Array<{
    id: string;
    kind: ActivityKind;
    ref_id: string | null;
    context: string | null;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    refId: r.ref_id,
    context: r.context,
    createdAt: r.created_at,
  }));
}

export function defaultCursor(): number {
  return nowMs() + 1;
}
