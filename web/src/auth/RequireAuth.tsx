import type { ReactNode } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** Gate a subtree behind Clerk; redirect to /login otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user, loading, syncError, refresh } = useAuth();
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
        <p className="muted" style={{ maxWidth: 480, textAlign: "center" }}>
          {syncError ??
            "Usually the API is missing CLERK_SECRET_KEY on Render, or the publishable/secret keys don’t match."}
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
