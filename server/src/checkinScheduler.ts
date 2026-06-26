import { config } from "./config.js";
import {
  claimDueOccurrences,
  claimOverdueOccurrences,
  markEscalated,
} from "./repos/checkins.js";
import { getPrimaryContact } from "./repos/sosContacts.js";
import { notifyContact } from "./notify.js";
import { emitCheckinDue } from "./realtime.js";
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
      }

      for (const overdue of claimOverdueOccurrences(now)) {
        const contact = getPrimaryContact(overdue.userId);
        notifyContact(
          overdue.occurrenceId,
          contact,
          "SafeSips check-in missed — please check on this person."
        );
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
