import { Link } from "react-router-dom";
import { useAuth as useClerkAuth } from "@clerk/react";

export default function VerifyEmailPage() {
  const { isSignedIn } = useClerkAuth();
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <h1>SafeSips</h1>
        </div>
        <h2>Email verification</h2>
        <p className="muted">
          Email verification is handled in your account menu. Open the profile
          icon in the top right if you still need to confirm your address.
        </p>
        <Link className="btn btn-primary btn-block" to={isSignedIn ? "/" : "/login"}>
          {isSignedIn ? "Go to the map" : "Sign in"}
        </Link>
      </div>
    </div>
  );
}
