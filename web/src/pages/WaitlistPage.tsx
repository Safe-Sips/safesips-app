import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import CaptchaWidget from "../components/CaptchaWidget";

const INTERESTS = ["user", "venue", "volunteer", "press", "investor"];

export default function WaitlistPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [interest, setInterest] = useState("user");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.waitlist({
        name,
        email,
        country: country || undefined,
        interest,
        captchaToken: captchaToken ?? undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not sign up.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <h1>SafeSips</h1>
        </div>
        {done ? (
          <>
            <h2 className="verify-ok">You're on the list ✓</h2>
            <p className="muted">
              Thanks for joining. We'll email you with SafeSips news and early
              access.
            </p>
            <Link className="btn btn-primary btn-block" to="/login">
              Back to login
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <p className="auth-tagline">
              Join the SafeSips waitlist &amp; newsletter.
            </p>
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={2}
                required
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <label className="field">
              <span>Country (optional)</span>
              <input
                type="text"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              />
            </label>
            <label className="field">
              <span>I'm interested as a…</span>
              <select value={interest} onChange={(e) => setInterest(e.target.value)}>
                {INTERESTS.map((i) => (
                  <option key={i} value={i}>
                    {i[0].toUpperCase() + i.slice(1)}
                  </option>
                ))}
              </select>
            </label>

            <CaptchaWidget onToken={setCaptchaToken} />

            {error && <p className="error">{error}</p>}

            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Joining…" : "Join the waitlist"}
            </button>
            <p className="auth-alt">
              Have an account? <Link to="/login">Log in</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
