import { useEffect, useState } from "react";
import {
  badgeForScore,
  nextBadge,
  type ActivityDTO,
  type ActivityKind,
  type UserStatsDTO,
} from "@safesips/shared";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import BadgeChip from "../components/BadgeChip";
import { timeAgo } from "../format";

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  report_created: "Reported a location",
  report_upvoted: "Upvoted a location",
  thread_created: "Started a discussion",
  post_created: "Replied in the forum",
  checkin_completed: "Completed a check-in",
};

const COUNT_LABELS: Array<{ key: keyof UserStatsDTO["counts"]; label: string }> = [
  { key: "reports", label: "Locations reported" },
  { key: "upvotesGiven", label: "Upvotes given" },
  { key: "upvotesReceived", label: "Upvotes received" },
  { key: "threads", label: "Discussions started" },
  { key: "posts", label: "Forum replies" },
  { key: "checkinsCompleted", label: "Check-ins completed" },
];

export default function ProfilePage() {
  const { user } = useAuth();
  const [stats, setStats] = useState<UserStatsDTO | null>(null);
  const [activity, setActivity] = useState<ActivityDTO[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [s, a] = await Promise.all([api.stats(), api.activity()]);
        if (!active) return;
        setStats(s);
        setActivity(a);
      } catch {
        if (active) setError("Could not load your profile.");
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const progress = stats ? nextBadge(stats.score) : null;
  const pct =
    progress && progress.ceil > progress.floor
      ? Math.min(
          100,
          Math.round(
            ((stats!.score - progress.floor) /
              (progress.ceil - progress.floor)) *
              100
          )
        )
      : 100;

  return (
    <div className="page profile-page">
      <div className="page-head">
        <h1>{user?.displayName}</h1>
        {stats && <BadgeChip tier={badgeForScore(stats.score)} />}
      </div>

      {error && <p className="error">{error}</p>}

      {stats && (
        <>
          <section className="card">
            <div className="profile-score">
              <div>
                <span className="profile-score-num">{stats.score}</span>
                <span className="muted"> reputation points</span>
              </div>
              {progress?.next ? (
                <p className="muted">
                  {progress.needed} more to reach{" "}
                  <strong className={`badge-text badge-${progress.next}`}>
                    {progress.next}
                  </strong>
                </p>
              ) : (
                <p className="muted">Top tier reached 🏆</p>
              )}
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
          </section>

          <section className="card">
            <h2>Your history</h2>
            <div className="stat-grid">
              {COUNT_LABELS.map(({ key, label }) => (
                <div className="stat-cell" key={key}>
                  <span className="stat-num">{stats.counts[key]}</span>
                  <span className="stat-label">{label}</span>
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      <section className="card">
        <h2>Recent activity</h2>
        {activity.length === 0 ? (
          <p className="muted">
            No activity yet. Report a place or join the forum to start earning
            badges.
          </p>
        ) : (
          <ul className="activity-feed">
            {activity.map((a) => (
              <li key={a.id} className="activity-item">
                <span className="activity-label">{ACTIVITY_LABEL[a.kind]}</span>
                {a.context && <span className="activity-context">{a.context}</span>}
                <span className="activity-time">{timeAgo(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
