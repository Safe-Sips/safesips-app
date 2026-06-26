import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api";
import { useAuth } from "../auth/AuthContext";

export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const { refresh, user } = useAuth();
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState("Verifying your email…");
  // Single-use tokens must be consumed exactly once, even under React
  // StrictMode's double-invoked effects in development.
  const consumed = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }
    // The `consumed` ref already guarantees this runs exactly once across
    // StrictMode's double-invoked effects, so we don't guard with a per-run
    // "active" flag — that flag would be flipped off by the first run's
    // cleanup and permanently swallow the result, freezing the UI on
    // "Verifying…". React 18 makes setState-after-unmount a safe no-op.
    if (consumed.current) return;
    consumed.current = true;
    (async () => {
      try {
        await api.verify(token);
        setStatus("ok");
        setMessage("Your email is verified — thank you!");
        await refresh();
      } catch (err) {
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Verification failed.");
      }
    })();
  }, [token, refresh]);

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <h1>SafeSips</h1>
        </div>
        <h2 className={status === "error" ? "verify-error" : "verify-ok"}>
          {status === "working"
            ? "Verifying…"
            : status === "ok"
              ? "Verified ✓"
              : "Couldn't verify"}
        </h2>
        <p className="muted">{message}</p>
        <Link className="btn btn-primary btn-block" to={user ? "/" : "/login"}>
          {user ? "Go to the map" : "Log in"}
        </Link>
      </div>
    </div>
  );
}
