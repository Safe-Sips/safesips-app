import type { ReactNode } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** Gate a subtree behind Clerk; redirect to /login otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user, loading, refresh } = useAuth();
  const location = useLocation();

  if (!isLoaded || loading) {
    return (
      <div className="boot-screen">
        <p>Loading SafeSips…</p>
      </div>
    );
  }
  if (!isSignedIn) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  if (!user) {
    return (
      <div className="boot-screen">
        <p>Could not connect your account to the SafeSips server.</p>
        <p className="muted" style={{ maxWidth: 420, textAlign: "center" }}>
          Usually the API is missing <code>CLERK_SECRET_KEY</code> on Render, or
          the publishable/secret keys don’t match. Refresh after fixing env
          vars.
        </p>
        <button
          className="btn btn-primary"
          type="button"
          onClick={() => void refresh()}
        >
          Try again
        </button>
      </div>
    );
  }
  return <>{children}</>;
}
