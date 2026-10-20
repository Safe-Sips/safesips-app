import { useEffect, useRef, useState } from "react";
import type { FriendsOverviewDTO, UserSearchResultDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import Avatar from "./Avatar";

const MIN_CHARS = 3;

/** Type a name, get people with similar names, send a request in one tap. */
export default function FriendSearch({ onChange }: { onChange: (o: FriendsOverviewDTO) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResultDTO[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const latest = useRef(0);

  // Search as you type (debounced); ignore answers to older queries.
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      setResults(null);
      setError(null);
      return;
    }
    const id = ++latest.current;
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const { results: r } = await api.searchUsers(q);
        if (id === latest.current) {
          setResults(r);
          setError(null);
        }
      } catch (err) {
        if (id === latest.current) setError(err instanceof ApiError ? err.message : "Search failed.");
      } finally {
        if (id === latest.current) setLoading(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const add = async (person: UserSearchResultDTO) => {
    setBusyId(person.userId);
    setError(null);
    try {
      const r = await api.addFriendById(person.userId);
      onChange(r.overview);
      const accepted = r.overview.friends.some((f) => f.userId === person.userId);
      setResults((rs) =>
        rs?.map((x) => (x.userId === person.userId ? { ...x, relation: accepted ? "friend" : "sent" } : x)) ?? rs
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the request.");
    } finally {
      setBusyId(null);
    }
  };

  const q = query.trim();
  return (
    <div className="friend-search">
      <input
        type="search"
        placeholder="Search by name"
        aria-label="Search people by name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {q.length > 0 && q.length < MIN_CHARS && (
        <p className="field-hint">Type at least {MIN_CHARS} letters.</p>
      )}
      {loading && results === null && <p className="field-hint" role="status">Searching…</p>}
      {results !== null && results.length === 0 && !loading && (
        <p className="muted">No one found. Try another spelling, or use their SafeSips code below.</p>
      )}
      {results && results.length > 0 && (
        <ul className="contact-list search-results">
          {results.map((p) => (
            <li key={p.userId} className="contact-row">
              <span className="friend-link">
                <Avatar name={p.displayName} imageUrl={p.imageUrl} size={36} />
                <strong>{p.displayName}</strong>
              </span>
              <span className="contact-actions">
                {p.relation === "friend" ? (
                  <span className="pill pill-primary">Friends</span>
                ) : p.relation === "sent" ? (
                  <span className="pill pill-paused">Request sent</span>
                ) : (
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    disabled={busyId === p.userId}
                    onClick={() => add(p)}
                  >
                    {p.relation === "received" ? "Accept" : "Add"}
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
