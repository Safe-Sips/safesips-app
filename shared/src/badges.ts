/**
 * Engagement badges (Reddit-style reputation).
 *
 * The badge tier is a PURE FUNCTION of a user's derived activity counts, so
 * the web and the server compute the exact same result and never drift. No
 * badge state is stored in the database — it is always recomputed from the
 * activity log + votes.
 */

export type BadgeTier = "none" | "bronze" | "silver" | "gold";

/** Counts derived from the activity log and vote tables for one user. */
export interface EngagementCounts {
  /** Safety reports this user created. */
  reports: number;
  /** Upvotes this user gave to others. */
  upvotesGiven: number;
  /** Upvotes this user's reports/posts received from others. */
  upvotesReceived: number;
  /** Forum threads started. */
  threads: number;
  /** Forum replies posted. */
  posts: number;
  /** Check-ins completed successfully. */
  checkinsCompleted: number;
}

export const EMPTY_COUNTS: EngagementCounts = {
  reports: 0,
  upvotesGiven: 0,
  upvotesReceived: 0,
  threads: 0,
  posts: 0,
  checkinsCompleted: 0,
};

/** Per-action weights that make up the engagement score. */
export const ENGAGEMENT_WEIGHTS: Readonly<EngagementCounts> = {
  reports: 5,
  upvotesGiven: 1,
  upvotesReceived: 3,
  threads: 5,
  posts: 2,
  checkinsCompleted: 2,
};

/** Minimum engagement score for each tier. */
export const BADGE_THRESHOLDS = {
  bronze: 10,
  silver: 50,
  gold: 200,
} as const;

/** Weighted total of a user's contributions. */
export function engagementScore(counts: EngagementCounts): number {
  return (
    counts.reports * ENGAGEMENT_WEIGHTS.reports +
    counts.upvotesGiven * ENGAGEMENT_WEIGHTS.upvotesGiven +
    counts.upvotesReceived * ENGAGEMENT_WEIGHTS.upvotesReceived +
    counts.threads * ENGAGEMENT_WEIGHTS.threads +
    counts.posts * ENGAGEMENT_WEIGHTS.posts +
    counts.checkinsCompleted * ENGAGEMENT_WEIGHTS.checkinsCompleted
  );
}

/** Tier for a raw engagement score. */
export function badgeForScore(score: number): BadgeTier {
  if (score >= BADGE_THRESHOLDS.gold) return "gold";
  if (score >= BADGE_THRESHOLDS.silver) return "silver";
  if (score >= BADGE_THRESHOLDS.bronze) return "bronze";
  return "none";
}

/** Convenience: tier directly from counts. */
export function badgeForCounts(counts: EngagementCounts): BadgeTier {
  return badgeForScore(engagementScore(counts));
}

/** Numeric level: none=0, bronze=1, silver=2, gold=3 ("level 1/2/3"). */
export function badgeLevel(tier: BadgeTier): 0 | 1 | 2 | 3 {
  switch (tier) {
    case "bronze":
      return 1;
    case "silver":
      return 2;
    case "gold":
      return 3;
    default:
      return 0;
  }
}

/** Human label for a tier. */
export function badgeLabel(tier: BadgeTier): string {
  switch (tier) {
    case "bronze":
      return "Bronze · Level 1";
    case "silver":
      return "Silver · Level 2";
    case "gold":
      return "Gold · Level 3";
    default:
      return "Newcomer";
  }
}

/**
 * Progress toward the next tier, for a progress bar.
 * Returns the next tier (or null at gold) and the score still needed.
 */
export function nextBadge(score: number): {
  next: BadgeTier | null;
  needed: number;
  floor: number;
  ceil: number;
} {
  if (score < BADGE_THRESHOLDS.bronze) {
    return {
      next: "bronze",
      needed: BADGE_THRESHOLDS.bronze - score,
      floor: 0,
      ceil: BADGE_THRESHOLDS.bronze,
    };
  }
  if (score < BADGE_THRESHOLDS.silver) {
    return {
      next: "silver",
      needed: BADGE_THRESHOLDS.silver - score,
      floor: BADGE_THRESHOLDS.bronze,
      ceil: BADGE_THRESHOLDS.silver,
    };
  }
  if (score < BADGE_THRESHOLDS.gold) {
    return {
      next: "gold",
      needed: BADGE_THRESHOLDS.gold - score,
      floor: BADGE_THRESHOLDS.silver,
      ceil: BADGE_THRESHOLDS.gold,
    };
  }
  return { next: null, needed: 0, floor: BADGE_THRESHOLDS.gold, ceil: BADGE_THRESHOLDS.gold };
}
