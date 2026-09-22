import { SignUp, useAuth as useClerkAuth } from "@clerk/react";
import { Navigate } from "react-router-dom";

export default function RegisterPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (!isLoaded) {
    return (
      <div className="auth-page">
        <p className="auth-loading">Loading…</p>
      </div>
    );
  }
  if (isSignedIn) return <Navigate to="/" replace />;

  return (
    <div className="auth-page">
      <SignUp
        routing="hash"
        signInUrl="/login"
        fallbackRedirectUrl="/"
      />
    </div>
  );
}
