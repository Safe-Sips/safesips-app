import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api";

export default function NewThreadPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const thread = await api.createThread({ title, body });
      navigate(`/forum/${thread.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not post.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <Link className="back-link" to="/forum">
          ← Forum
        </Link>
        <h1>New discussion</h1>
      </div>
      <form className="card" onSubmit={submit}>
        <label className="field">
          <span>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            minLength={3}
            maxLength={140}
            required
          />
        </label>
        <label className="field">
          <span>Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            minLength={3}
            required
          />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? "Posting…" : "Post discussion"}
        </button>
      </form>
    </div>
  );
}
