import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  type ActivityDTO,
  type ActivityKind,
  type UserStatsDTO,
} from "@safesips/shared";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import Avatar from "../components/Avatar";
import { timeAgo } from "../format";

const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  report_created: "Reported a place",
  report_upvoted: "Upvoted a report",
  thread_created: "Started a discussion",
  post_created: "Replied in the forum",
  checkin_completed: "Completed a check-in",
};

const COUNT_LABELS: Array<{ key: keyof UserStatsDTO["counts"]; label: string }> = [
  { key: "reports", label: "Places reported" },
  { key: "upvotesGiven", label: "Upvotes given" },
  { key: "upvotesReceived", label: "Upvotes received" },
  { key: "threads", label: "Discussions started" },
  { key: "posts", label: "Forum replies" },
  { key: "checkinsCompleted", label: "Check-ins completed" },
];

/** People I've blocked, with Unblock. */
function BlockedPeopleSection() {
  const [blocks, setBlocks] = useState<Array<{ userId: string; displayName: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .blocks()
      .then((r) => setBlocks(r.blocks))
      .catch(() => setError("Couldn't load the people you've blocked."));
  }, []);

  if (!error && (!blocks || blocks.length === 0)) return null;
  return (
    <section className="card">
      <h2>Blocked people</h2>
      <p className="muted">
        You don't see their posts, discussions or map reports, and they can't
        send you friend requests.
      </p>
      {error && <p className="error">{error}</p>}
      <ul className="contact-list">
        {blocks?.map((b) => (
          <li key={b.userId} className="contact-row">
            <strong>{b.displayName}</strong>
            <span className="contact-actions">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={async () => {
                  setError(null);
                  try {
                    setBlocks((await api.unblockUser(b.userId)).blocks);
                  } catch {
                    setError("Couldn't unblock. Try again.");
                  }
                }}
              >
                Unblock
              </button>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** GDPR rights: download everything we store, or erase the account. */
function YourDataSection() {
  const { logout } = useAuth();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setError(null);
    setBusy("export");
    try {
      const data = await api.exportMyData();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "safesips-data-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't download your data. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setError(null);
    setBusy("delete");
    try {
      await api.deleteAccount();
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't delete your account. Try again.");
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <h2>Your data</h2>
      <p className="muted">
        Download a copy of everything SafeSips stores about you, or permanently
        delete your account.
      </p>
      <div className="data-actions">
        <button
          className="btn btn-ghost"
          onClick={download}
          disabled={busy !== null}
        >
          {busy === "export" ? "Preparing…" : "Download my data"}
        </button>
        {!showDelete && (
          <button
            className="btn btn-danger"
            onClick={() => setShowDelete(true)}
            disabled={busy !== null}
          >
            Delete my account
          </button>
        )}
      </div>

      {showDelete && (
        <div className="danger-zone">
          <p>
            This permanently deletes your account and everything in it: your
            reports, discussions and replies (including other people's replies
            in your discussions), votes, friends, emergency contacts, alerts,
            check-ins and activity. <strong>It can't be undone.</strong>
          </p>
          <label className="field">
            <span>Type DELETE to confirm</span>
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
            />
          </label>
          <div className="data-actions">
            <button
              className="btn btn-danger"
              onClick={remove}
              disabled={confirmText !== "DELETE" || busy !== null}
            >
              {busy === "delete" ? "Deleting…" : "Permanently delete"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setShowDelete(false);
                setConfirmText("");
              }}
              disabled={busy !== null}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

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

  return (
    <div className="page profile-page">
      <div className="page-head profile-hero">
        {user && <Avatar name={user.displayName} imageUrl={user.imageUrl ?? null} size={72} />}
        <h1>{user?.displayName}</h1>
      </div>

      {error && <p className="error">{error}</p>}

      {stats && (
        <>
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
            No activity yet. <Link to="/">Report a place on the map</Link> or{" "}
            <Link to="/forum">join the forum</Link>.
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

      <BlockedPeopleSection />
      <YourDataSection />
    </div>
  );
}
