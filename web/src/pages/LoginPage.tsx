import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/" replace />;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not log in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={onSubmit}>
        <div className="auth-brand">
          <span className="brand-mark" aria-hidden />
          <h1>SafeSips</h1>
        </div>
        <p className="auth-tagline">Welcome back. Log in to your safety map.</p>

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
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error && <p className="error">{error}</p>}

        <button className="btn btn-primary btn-block" disabled={busy} type="submit">
          {busy ? "Logging in…" : "Log in"}
        </button>

        <p className="auth-alt">
          New here? <Link to="/register">Create an account</Link>
        </p>
        <p className="auth-alt">
          Not ready yet? <Link to="/waitlist">Join the waitlist</Link>
        </p>
        <p className="auth-emergency">
          In an emergency call <strong>112</strong>. See{" "}
          <Link to="/first-aid">spiking first-aid info</Link>.
        </p>
      </form>
    </div>
  );
}
