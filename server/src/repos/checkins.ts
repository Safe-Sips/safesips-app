import type {
  CheckinAnswerResult,
  CheckinOccurrenceDTO,
  CheckinOccurrenceStatus,
  CheckinPlanInput,
  CheckinPlanStatus,
  PlanDTO,
} from "@safesips/shared";
import { db } from "../db.js";
import { hashSecret, verifySecret } from "../auth/passwords.js";
import { genId, normalizeAnswer, nowMs } from "../util.js";
import { logActivity } from "./activity.js";

interface PlanRow {
  id: string;
  user_id: string;
  label: string | null;
  interval_minutes: number;
  grace_minutes: number;
  question: string;
  answer_hash: string;
  status: CheckinPlanStatus;
  started_at: number;
  ends_at: number | null;
  created_at: number;
}

interface OccRow {
  id: string;
  plan_id: string;
  user_id: string;
  due_at: number;
  deadline_at: number;
  status: CheckinOccurrenceStatus;
  prompted_at: number | null;
  answered_at: number | null;
  created_at: number;
}

const MINUTE = 60_000;

const insertPlan = db.prepare(
  `INSERT INTO checkin_plans
     (id, user_id, label, interval_minutes, grace_minutes, question, answer_hash, status, started_at, ends_at, created_at)
   VALUES
     (@id, @user_id, @label, @interval_minutes, @grace_minutes, @question, @answer_hash, 'active', @started_at, @ends_at, @created_at)`
);
const insertOccurrence = db.prepare(
  `INSERT INTO checkin_occurrences
     (id, plan_id, user_id, due_at, deadline_at, status, prompted_at, answered_at, created_at)
   VALUES (@id, @plan_id, @user_id, @due_at, @deadline_at, 'pending', NULL, NULL, @created_at)`
);
const selectPlansByUser = db.prepare(
  `SELECT p.*,
     (SELECT MIN(o.due_at) FROM checkin_occurrences o
       WHERE o.plan_id = p.id AND o.status IN ('pending','prompted')) AS next_due
   FROM checkin_plans p
   WHERE p.user_id = ? AND p.status != 'ended'
   ORDER BY p.created_at DESC`
);
const selectPlanById = db.prepare(`SELECT * FROM checkin_plans WHERE id = ?`);
const setPlanStatusOwned = db.prepare(
  `UPDATE checkin_plans SET status = ? WHERE id = ? AND user_id = ?`
);
const setPlanStatus = db.prepare(`UPDATE checkin_plans SET status = ? WHERE id = ?`);
const cancelPendingOccurrences = db.prepare(
  `DELETE FROM checkin_occurrences WHERE plan_id = ? AND status IN ('pending','prompted')`
);

const selectActiveOccurrence = db.prepare(
  `SELECT o.*, p.question AS plan_question
   FROM checkin_occurrences o JOIN checkin_plans p ON p.id = o.plan_id
   WHERE o.user_id = ? AND o.status IN ('pending','prompted')
     AND o.due_at <= ? AND o.deadline_at > ?
   ORDER BY o.deadline_at ASC LIMIT 1`
);
const selectOccurrenceOwned = db.prepare(
  `SELECT * FROM checkin_occurrences WHERE id = ? AND user_id = ?`
);
const setOccurrenceAnswered = db.prepare(
  `UPDATE checkin_occurrences SET status = 'answered', answered_at = ? WHERE id = ?`
);
const selectOccurrencesPage = db.prepare(
  `SELECT o.*, p.question AS plan_question
   FROM checkin_occurrences o JOIN checkin_plans p ON p.id = o.plan_id
   WHERE o.user_id = ? AND o.created_at < ?
   ORDER BY o.created_at DESC LIMIT ?`
);

// Scheduler scans.
const selectDue = db.prepare(
  `SELECT o.id, o.plan_id, o.user_id, o.deadline_at, p.question AS plan_question
   FROM checkin_occurrences o JOIN checkin_plans p ON p.id = o.plan_id
   WHERE o.status = 'pending' AND o.due_at <= ? AND p.status = 'active'`
);
const setPrompted = db.prepare(
  `UPDATE checkin_occurrences SET status = 'prompted', prompted_at = ? WHERE id = ? AND status = 'pending'`
);
const selectOverdue = db.prepare(
  `SELECT id, plan_id, user_id FROM checkin_occurrences WHERE status = 'prompted' AND deadline_at <= ?`
);
const setMissed = db.prepare(
  `UPDATE checkin_occurrences SET status = 'missed' WHERE id = ? AND status = 'prompted'`
);
const setEscalated = db.prepare(
  `UPDATE checkin_occurrences SET status = 'escalated' WHERE id = ?`
);

function planToDTO(p: PlanRow, nextDueAt: number | null): PlanDTO {
  return {
    id: p.id,
    label: p.label,
    intervalMinutes: p.interval_minutes,
    graceMinutes: p.grace_minutes,
    question: p.question,
    status: p.status,
    startedAt: p.started_at,
    endsAt: p.ends_at,
    createdAt: p.created_at,
    nextDueAt,
  };
}

function occToDTO(o: OccRow, question: string): CheckinOccurrenceDTO {
  return {
    id: o.id,
    planId: o.plan_id,
    question,
    dueAt: o.due_at,
    deadlineAt: o.deadline_at,
    status: o.status,
    promptedAt: o.prompted_at,
    answeredAt: o.answered_at,
  };
}

/** Insert the next pending occurrence for a plan, respecting ends_at. */
function scheduleNext(plan: PlanRow, fromDueAt: number): number | null {
  if (plan.status !== "active") return null;
  const nextDue = fromDueAt + plan.interval_minutes * MINUTE;
  if (plan.ends_at != null && nextDue > plan.ends_at) {
    setPlanStatus.run("ended", plan.id);
    return null;
  }
  insertOccurrence.run({
    id: genId(),
    plan_id: plan.id,
    user_id: plan.user_id,
    due_at: nextDue,
    deadline_at: nextDue + plan.grace_minutes * MINUTE,
    created_at: nowMs(),
  });
  return nextDue;
}

export const createPlan = db.transaction(
  (userId: string, input: CheckinPlanInput): PlanDTO => {
    const now = nowMs();
    const planId = genId();
    const interval = input.intervalMinutes;
    const grace = input.graceMinutes;
    const plan: PlanRow = {
      id: planId,
      user_id: userId,
      label: input.label ?? null,
      interval_minutes: interval,
      grace_minutes: grace,
      question: input.question,
      answer_hash: hashSecret(normalizeAnswer(input.answer)),
      status: "active",
      started_at: now,
      ends_at: input.endsAt ?? null,
      created_at: now,
    };
    insertPlan.run(plan);

    const firstDue = now + interval * MINUTE;
    let nextDue: number | null = null;
    if (plan.ends_at == null || firstDue <= plan.ends_at) {
      insertOccurrence.run({
        id: genId(),
        plan_id: planId,
        user_id: userId,
        due_at: firstDue,
        deadline_at: firstDue + grace * MINUTE,
        created_at: now,
      });
      nextDue = firstDue;
    }
    return planToDTO(plan, nextDue);
  }
) as (userId: string, input: CheckinPlanInput) => PlanDTO;

export function listPlans(userId: string): PlanDTO[] {
  const rows = selectPlansByUser.all(userId) as Array<
    PlanRow & { next_due: number | null }
  >;
  return rows.map((r) => planToDTO(r, r.next_due));
}

export function pausePlan(userId: string, planId: string): boolean {
  const tx = db.transaction(() => {
    const changed = setPlanStatusOwned.run("paused", planId, userId).changes > 0;
    if (changed) cancelPendingOccurrences.run(planId);
    return changed;
  });
  return tx();
}

export function endPlan(userId: string, planId: string): boolean {
  const tx = db.transaction(() => {
    const changed = setPlanStatusOwned.run("ended", planId, userId).changes > 0;
    if (changed) cancelPendingOccurrences.run(planId);
    return changed;
  });
  return tx();
}

export function getActiveOccurrence(userId: string): CheckinOccurrenceDTO | null {
  const now = nowMs();
  const row = selectActiveOccurrence.get(userId, now, now) as
    | (OccRow & { plan_question: string })
    | undefined;
  if (!row) return null;
  return occToDTO(row, row.plan_question);
}

export function listOccurrences(
  userId: string,
  before: number,
  limit: number
): CheckinOccurrenceDTO[] {
  const rows = selectOccurrencesPage.all(userId, before, limit) as Array<
    OccRow & { plan_question: string }
  >;
  return rows.map((r) => occToDTO(r, r.plan_question));
}

/** Answer an occurrence. Returns null when it doesn't exist for this user. */
export const answerOccurrence = db.transaction(
  (
    userId: string,
    occurrenceId: string,
    answer: string
  ): CheckinAnswerResult | null => {
    const occ = selectOccurrenceOwned.get(occurrenceId, userId) as
      | OccRow
      | undefined;
    if (!occ) return null;
    const plan = selectPlanById.get(occ.plan_id) as PlanRow;

    if (occ.status === "answered") {
      return { correct: true, expired: false, occurrence: occToDTO(occ, plan.question) };
    }
    const now = nowMs();
    if (
      occ.status === "missed" ||
      occ.status === "escalated" ||
      occ.deadline_at <= now
    ) {
      return { correct: false, expired: true, occurrence: occToDTO(occ, plan.question) };
    }

    const correct = verifySecret(normalizeAnswer(answer), plan.answer_hash);
    if (!correct) {
      return { correct: false, expired: false, occurrence: occToDTO(occ, plan.question) };
    }

    setOccurrenceAnswered.run(now, occ.id);
    logActivity(userId, "checkin_completed", occ.id, plan.label ?? null);
    scheduleNext(plan, occ.due_at);

    const updated: OccRow = { ...occ, status: "answered", answered_at: now };
    return { correct: true, expired: false, occurrence: occToDTO(updated, plan.question) };
  }
) as (
  userId: string,
  occurrenceId: string,
  answer: string
) => CheckinAnswerResult | null;

/* ----------------------------- Scheduler API ---------------------------- */

export interface DueOccurrence {
  occurrenceId: string;
  planId: string;
  userId: string;
  question: string;
  deadlineAt: number;
}

/** Flip due pending occurrences to 'prompted' and return them for emitting. */
export function claimDueOccurrences(now: number): DueOccurrence[] {
  const rows = selectDue.all(now) as Array<{
    id: string;
    plan_id: string;
    user_id: string;
    deadline_at: number;
    plan_question: string;
  }>;
  const claimed: DueOccurrence[] = [];
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (setPrompted.run(now, r.id).changes > 0) {
        claimed.push({
          occurrenceId: r.id,
          planId: r.plan_id,
          userId: r.user_id,
          question: r.plan_question,
          deadlineAt: r.deadline_at,
        });
      }
    }
  });
  tx();
  return claimed;
}

export interface OverdueOccurrence {
  occurrenceId: string;
  userId: string;
}

/** Flip overdue prompted occurrences to 'missed' and return them to escalate. */
export function claimOverdueOccurrences(now: number): OverdueOccurrence[] {
  const rows = selectOverdue.all(now) as Array<{
    id: string;
    plan_id: string;
    user_id: string;
  }>;
  const claimed: OverdueOccurrence[] = [];
  const tx = db.transaction(() => {
    for (const r of rows) {
      if (setMissed.run(r.id).changes > 0) {
        claimed.push({ occurrenceId: r.id, userId: r.user_id });
      }
    }
  });
  tx();
  return claimed;
}

export function markEscalated(occurrenceId: string): void {
  setEscalated.run(occurrenceId);
}
