import {
  badgeForScore,
  engagementScore,
  type EngagementCounts,
  type UserStatsDTO,
} from "@safesips/shared";
import { db } from "../db.js";

const qReports = db.prepare(
  `SELECT COUNT(*) AS c FROM reports WHERE author_id = ? AND status = 'visible'`
);
const qReportVotesGiven = db.prepare(
  `SELECT COUNT(*) AS c FROM report_votes WHERE user_id = ?`
);
const qPostVotesGiven = db.prepare(
  `SELECT COUNT(*) AS c FROM forum_post_votes WHERE user_id = ?`
);
const qReportVotesReceived = db.prepare(
  `SELECT COUNT(*) AS c FROM report_votes v
   JOIN reports r ON r.id = v.report_id WHERE r.author_id = ?`
);
const qPostVotesReceived = db.prepare(
  `SELECT COUNT(*) AS c FROM forum_post_votes v
   JOIN forum_posts p ON p.id = v.post_id WHERE p.author_id = ?`
);
const qThreads = db.prepare(
  `SELECT COUNT(*) AS c FROM forum_threads WHERE author_id = ? AND status = 'visible'`
);
const qPosts = db.prepare(
  `SELECT COUNT(*) AS c FROM forum_posts WHERE author_id = ? AND status = 'visible'`
);
const qCheckins = db.prepare(
  `SELECT COUNT(*) AS c FROM activity_log WHERE user_id = ? AND kind = 'checkin_completed'`
);

function count(stmt: ReturnType<typeof db.prepare>, userId: string): number {
  return (stmt.get(userId) as { c: number }).c;
}

export function computeCounts(userId: string): EngagementCounts {
  return {
    reports: count(qReports, userId),
    upvotesGiven: count(qReportVotesGiven, userId) + count(qPostVotesGiven, userId),
    upvotesReceived:
      count(qReportVotesReceived, userId) + count(qPostVotesReceived, userId),
    threads: count(qThreads, userId),
    posts: count(qPosts, userId),
    checkinsCompleted: count(qCheckins, userId),
  };
}

export function computeStats(userId: string): UserStatsDTO {
  const counts = computeCounts(userId);
  const score = engagementScore(counts);
  return { counts, score, badge: badgeForScore(score) };
}
