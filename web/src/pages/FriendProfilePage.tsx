import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { FriendProfileDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import Avatar from "../components/Avatar";

const COUNT_LABELS: Array<{ key: keyof FriendProfileDTO["counts"]; label: string }> = [
  { key: "reports", label: "Places reported" },
  { key: "upvotesReceived", label: "Upvotes received" },
  { key: "threads", label: "Discussions started" },
  { key: "posts", label: "Forum replies" },
];

function monthYear(ts: number): string {
  return new Date(ts).toLocaleDateString([], { month: "long", year: "numeric" });
}

/** A friend's profile, with "add as emergency contact" and "remove friend". */
export default function FriendProfilePage() {
  const { userId = "" } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<FriendProfileDTO | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  useEffect(() => {
    let active = true;
    setProfile(null);
    setNotFound(false);
    api
      .friendProfile(userId)
      .then((p) => active && setProfile(p))
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 404) setNotFound(true);
        else setError("Couldn't load this profile.");
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const askAsContact = async () => {
    setError(null);
    setBusy(true);
    try {
      setProfile(await api.askFriendAsContact(userId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const unfriend = async () => {
    if (!profile) return;
    setError(null);
    setBusy(true);
    try {
      await api.removeFriend(profile.friendshipId);
      navigate("/friends", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't remove this friend.");
      setBusy(false);
    }
  };

  if (notFound) {
    return (
      <div className="page friend-profile-page">
        <div className="state-card">
          <p className="state-title">Profile not available</p>
          <p className="muted">You can only see the profiles of your friends.</p>
          <Link className="btn btn-ghost" to="/friends">Back to friends</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="page friend-profile-page">
      <div className="page-head">
        <Link className="back-link" to="/friends">← Friends</Link>
      </div>
      {error && <p className="error">{error}</p>}
      {!profile ? (
        !error && <p className="muted" role="status">Loading…</p>
      ) : (
        <>
          <div className="profile-hero">
            <Avatar name={profile.displayName} imageUrl={profile.imageUrl} size={88} />
            <div>
              <h1>{profile.displayName}</h1>
              <p className="muted">
                On SafeSips since {monthYear(profile.memberSince)} · friends since{" "}
                {monthYear(profile.friendsSince)}
              </p>
            </div>
          </div>

          <section className="card">
            <h2>Emergency contact</h2>
            {profile.emergencyContact === "accepted" ? (
              <p>
                <span className="pill pill-primary">Your emergency contact</span>{" "}
                <span className="muted">They're alerted if you miss a check-in.</span>
              </p>
            ) : profile.emergencyContact === "pending" ? (
              <p>
                <span className="pill pill-paused">Request sent</span>{" "}
                <span className="muted">Waiting for {profile.displayName} to accept.</span>
              </p>
            ) : (
              <>
                <p className="muted">
                  Ask {profile.displayName} to be alerted if you miss a check-in.
                  They'll need to accept.
                </p>
                <button className="btn btn-primary" type="button" disabled={busy} onClick={askAsContact}>
                  {busy ? "Sending…" : "Add as emergency contact"}
                </button>
              </>
            )}
          </section>

          <section className="card">
            <h2>Activity</h2>
            <div className="stat-grid">
              {COUNT_LABELS.map(({ key, label }) => (
                <div className="stat-cell" key={key}>
                  <span className="stat-num">{profile.counts[key]}</span>
                  <span className="stat-label">{label}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            {!confirmRemove ? (
              <div className="data-actions">
                <button className="btn btn-ghost" type="button" onClick={() => setConfirmRemove(true)}>
                  Remove friend
                </button>
                <button
                  className="btn btn-ghost"
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        `Block ${profile.displayName}? This removes them as a friend and ends any emergency-contact link between you. You won't see their posts or map reports, and they can't send you friend requests.`
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await api.blockUser(profile.userId);
                      navigate("/friends", { replace: true });
                    } catch (err) {
                      setError(err instanceof ApiError ? err.message : "Couldn't block them. Try again.");
                      setBusy(false);
                    }
                  }}
                >
                  Block
                </button>
              </div>
            ) : (
              <div className="data-actions">
                <span>
                  Remove {profile.displayName} from your friends? They won't be able to send you
                  friend requests unless you add them again.
                </span>
                <button className="btn btn-danger" type="button" disabled={busy} onClick={unfriend}>
                  Remove
                </button>
                <button className="btn btn-ghost" type="button" onClick={() => setConfirmRemove(false)}>
                  Cancel
                </button>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
