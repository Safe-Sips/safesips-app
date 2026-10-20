import { config } from "./config.js";
import {
  claimDueOccurrences,
  claimOverdueOccurrences,
  markEscalated,
} from "./repos/checkins.js";
import { findUserById } from "./repos/users.js";
import { alertEmergencyContacts, promptCheckin } from "./notify.js";
import { emitCheckinDue, getSharedArea } from "./realtime.js";
import { purgeOldAttempts } from "./auth/throttle.js";
import { nowMs } from "./util.js";

/**
 * Server-side check-in sweep (mirrors the presence sweep). Runs regardless of
 * whether the user's app is connected, so a missed check-in always escalates.
 *
 *   pending  + due  → prompted  (push checkin:due to the user's sockets)
 *   prompted + late → missed → escalate to primary SOS contact → escalated
 */
export function startCheckinScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => {
    try {
      const now = nowMs();

      for (const due of claimDueOccurrences(now)) {
        emitCheckinDue(due.userId, {
          occurrenceId: due.occurrenceId,
          planId: due.planId,
          question: due.question,
          deadlineAt: due.deadlineAt,
        });
        // Also reaches them with the app closed (push notification).
        void promptCheckin(due.userId, due.occurrenceId, due.deadlineAt);
      }

      for (const overdue of claimOverdueOccurrences(now)) {
        const user = findUserById(overdue.userId);
        // Delivery is async (push); the occurrence is already claimed as
        // missed, so mark it escalated now. alertEmergencyContacts alerts every
        // accepted contact in-app, records each outcome, and never throws.
        void alertEmergencyContacts({
          occurrenceId: overdue.occurrenceId,
          userId: overdue.userId,
          personName: user?.display_name ?? "A SafeSips user",
          planLabel: overdue.planLabel,
          area: getSharedArea(overdue.userId),
        });
        markEscalated(overdue.occurrenceId);
      }

      // Opportunistically prune stale auth-throttle rows.
      purgeOldAttempts();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Check-in sweep failed:", err);
    }
  }, config.checkinSweepIntervalMs);
  timer.unref?.();
  return timer;
}
