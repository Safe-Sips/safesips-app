import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";
import CaptchaWidget from "../components/CaptchaWidget";

export default function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register({
        email,
        password,
        displayName,
        captchaToken: captchaToken ?? undefined,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not create account."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <h1>SafeSips</h1>
        </div>
        <p className="auth-tagline">
          Create an account. We verify emails to keep bots out so the community
          stays real.
        </p>

        <label className="field">
          <span>Display name</span>
          <input
            type="text"
            autoComplete="nickname"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            minLength={2}
            maxLength={40}
            required
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
          <small className="field-hint">At least 8 characters.</small>
        </label>

        <CaptchaWidget onToken={setCaptchaToken} />

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary btn-block" disabled={busy} type="submit">
          {busy ? "Creating…" : "Create account"}
        </button>

        <p className="auth-alt">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </form>
    </div>
  );
}
