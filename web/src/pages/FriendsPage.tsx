import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FriendsOverviewDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import { timeAgo } from "../format";
import Avatar from "../components/Avatar";
import FriendSearch from "../components/FriendSearch";
import { useSocket } from "../socket/SocketProvider";
import MoreInfo from "../components/MoreInfo";

/** Your friends (and which are emergency contacts), requests, and adding someone by name or email. */
export default function FriendsPage() {
  const { socket } = useSocket();
  const [overview, setOverview] = useState<FriendsOverviewDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setOverview(await api.friends());
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load your friends.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Someone sent, accepted or removed a request.
  useEffect(() => {
    if (!socket) return;
    const onChanged = () => void load();
    socket.on("friends:changed", onChanged);
    return () => {
      socket.off("friends:changed", onChanged);
    };
  }, [socket, load]);

  const run = async (fn: () => Promise<FriendsOverviewDTO>) => {
    setError(null);
    try {
      setOverview(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const r = await api.addFriend(identifier);
      setMessage(r.message);
      setIdentifier("");
      setOverview(r.overview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const askContact = async (userId: string) => {
    setListError(null);
    setAsking(userId);
    try {
      await api.askFriendAsContact(userId);
      setOverview(await api.friends());
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "Couldn't send the request.");
    } finally {
      setAsking(null);
    }
  };

  return (
    <div className="page friends-page">
      <div className="page-head">
        <h1>Friends</h1>
      </div>
      {loadError && <p className="error">{loadError}</p>}

      {overview && (
        <>
          <section className="card">
            <h2>Add a friend</h2>
            <FriendSearch onChange={setOverview} />
            <h3>Or add them by email</h3>
            <form className="inline-form" onSubmit={add}>
              <input
                type="email"
                placeholder="Their email"
                aria-label="Their email"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                required
              />
              <button className="btn btn-secondary btn-sm" disabled={busy} type="submit">
                {busy ? "Sending…" : "Send request"}
              </button>
            </form>
            {message && <p className="hint" role="status">{message}</p>}
            {error && <p className="error">{error}</p>}
          </section>

          {overview.incoming.length > 0 && (
            <section className="card" aria-label="Friend requests for you">
              <h2>Requests for you</h2>
              <MoreInfo label="What happens if I decline?">
                They aren't told, and they can't send you new requests unless you add them.
              </MoreInfo>
              <ul className="contact-list">
                {overview.incoming.map((r) => (
                  <li key={r.id} className="contact-row">
                    <span>
                      <strong>{r.fromDisplayName}</strong> wants to be friends.
                      <span className="muted"> {timeAgo(r.createdAt)}</span>
                    </span>
                    <span className="contact-actions">
                      <button className="btn btn-primary btn-sm" type="button" onClick={() => run(() => api.acceptFriend(r.id))}>
                        Accept
                      </button>
                      <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(() => api.removeFriend(r.id))}>
                        Decline
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="card">
            <h2>Your friends</h2>
            {overview.friends.length === 0 ? (
              <p className="muted">No friends yet. Search for them by name, or add them by email.</p>
            ) : (
              <>
                <table className="friends-table">
                  <thead>
                    <tr>
                      <th scope="col">Friend</th>
                      <th scope="col">Emergency contact</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.friends.map((f) => (
                      <tr key={f.id}>
                        <td>
                          <Link className="friend-link" to={`/friends/${encodeURIComponent(f.userId)}`}>
                            <Avatar name={f.displayName} imageUrl={f.imageUrl} size={36} />
                            <span className="friend-name">{f.displayName}</span>
                          </Link>
                        </td>
                        <td>
                          {f.emergencyContact === "accepted" ? (
                            <span className="pill pill-primary">Yes</span>
                          ) : f.emergencyContact === "pending" ? (
                            <span className="pill pill-paused">Asked</span>
                          ) : (
                            <button
                              className="btn btn-ghost btn-sm"
                              type="button"
                              disabled={asking === f.userId}
                              aria-label={`Ask ${f.displayName} to be your emergency contact`}
                              onClick={() => void askContact(f.userId)}
                            >
                              {asking === f.userId ? "Asking…" : "Ask"}
                            </button>
                          )}
                          {f.isTheirContact && <span className="friend-theirs">You're theirs</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <MoreInfo label="What do these mean?">
                  <strong>Yes</strong>: they're alerted if you miss a check-in. <strong>Asked</strong>: waiting
                  for them to accept. <strong>You're theirs</strong>: you're alerted if they miss one.
                </MoreInfo>
                {listError && <p className="error">{listError}</p>}
              </>
            )}

            {overview.outgoing.length > 0 && (
              <>
                <h3>Waiting for them to accept</h3>
                <ul className="contact-list">
                  {overview.outgoing.map((o) => (
                    <li key={o.id} className="contact-row">
                      <span>
                        <strong>{o.label}</strong>
                        <span className="muted"> {timeAgo(o.createdAt)}</span>
                      </span>
                      <span className="contact-actions">
                        <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(() => api.removeFriend(o.id))}>
                          Cancel
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
