import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { FriendsOverviewDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import { timeAgo } from "../format";
import { useSocket } from "../socket/SocketProvider";

/** Your friends, requests, and adding someone by SafeSips code or email. */
export default function FriendsPage() {
  const { socket } = useSocket();
  const [overview, setOverview] = useState<FriendsOverviewDTO | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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

  const copyCode = async () => {
    if (!overview) return;
    try {
      await navigator.clipboard.writeText(overview.myCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code is visible to copy by hand */
    }
  };

  return (
    <div className="page friends-page">
      <div className="page-head">
        <h1>Friends</h1>
      </div>
      <p className="muted">
        Add the people you go out with. Friends can see each other's profile,
        and you can ask a friend to be your emergency contact in one tap.
      </p>
      {loadError && <p className="error">{loadError}</p>}

      {overview && (
        <>
          <section className="card">
            <h2>Add a friend</h2>
            <p className="my-code">
              Your SafeSips code: <strong className="code-chip">{overview.myCode}</strong>{" "}
              <button className="btn btn-ghost btn-sm" type="button" onClick={copyCode}>
                {copied ? "Copied" : "Copy"}
              </button>
              <span className="field-hint"> Give it to friends who want to add you.</span>
            </p>
            <form className="inline-form" onSubmit={add}>
              <input
                placeholder="Their SafeSips code or email"
                aria-label="Their SafeSips code or email"
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
              <p className="muted">No friends yet. Send a request with their SafeSips code or email.</p>
            ) : (
              <ul className="contact-list">
                {overview.friends.map((f) => (
                  <li key={f.id} className="contact-row">
                    <span>
                      <Link to={`/friends/${encodeURIComponent(f.userId)}`}>
                        <strong>{f.displayName}</strong>
                      </Link>
                    </span>
                    <span className="contact-actions">
                      <Link className="btn btn-ghost btn-sm" to={`/friends/${encodeURIComponent(f.userId)}`}>
                        View profile
                      </Link>
                    </span>
                  </li>
                ))}
              </ul>
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
