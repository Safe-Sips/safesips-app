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
    let active = true;
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token.");
      return;
    }
    if (consumed.current) return;
    consumed.current = true;
    (async () => {
      try {
        await api.verify(token);
        if (!active) return;
        setStatus("ok");
        setMessage("Your email is verified — thank you!");
        await refresh();
      } catch (err) {
        if (!active) return;
        setStatus("error");
        setMessage(err instanceof ApiError ? err.message : "Verification failed.");
      }
    })();
    return () => {
      active = false;
    };
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
