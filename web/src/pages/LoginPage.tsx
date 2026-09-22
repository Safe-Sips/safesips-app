import { SignIn, useAuth as useClerkAuth } from "@clerk/react";
import { Navigate } from "react-router-dom";

export default function LoginPage() {
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
      <SignIn
        routing="hash"
        signUpUrl="/register"
        fallbackRedirectUrl="/"
      />
    </div>
  );
}
