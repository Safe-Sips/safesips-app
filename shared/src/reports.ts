/**
 * Safety reports are a snapshot in time: a place that felt unsafe tonight may
 * be fine next week. So a report fades on the map as it ages and disappears
 * after REPORT_VISIBLE_MS. The server stops returning expired reports; the
 * client fades the rest using the same rules.
 */

/** How long a report stays on the map (48 h). */
export const REPORT_VISIBLE_MS = 48 * 60 * 60 * 1000;

/** Opacity a report has just before it disappears (it starts at 1). */
export const REPORT_MIN_OPACITY = 0.6;

/** True once a report is too old to show. */
export function isReportExpired(createdAt: number, now: number): boolean {
  return now - createdAt >= REPORT_VISIBLE_MS;
}

/**
 * Display opacity for a report: 1 when new, falling linearly to
 * REPORT_MIN_OPACITY at REPORT_VISIBLE_MS (after which it's hidden).
 */
export function reportOpacity(createdAt: number, now: number): number {
  const age = Math.max(0, now - createdAt);
  const progress = Math.min(1, age / REPORT_VISIBLE_MS);
  return 1 - (1 - REPORT_MIN_OPACITY) * progress;
}
