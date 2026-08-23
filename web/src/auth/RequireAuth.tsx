import type { ReactNode } from "react";
import { useAuth as useClerkAuth } from "@clerk/react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";

/** Gate a subtree behind Clerk; redirect to /login otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useClerkAuth();
  const { user, loading } = useAuth();
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
        <p>Could not connect your account. Please refresh and try again.</p>
      </div>
    );
  }
  return <>{children}</>;
}
