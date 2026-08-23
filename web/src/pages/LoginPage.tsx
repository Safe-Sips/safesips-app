import { SignIn, useAuth as useClerkAuth } from "@clerk/react";
import { Link, Navigate } from "react-router-dom";
import PublicNav from "../components/PublicNav";

export default function LoginPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (!isLoaded) {
    return (
      <div className="boot-screen">
        <p>Loading SafeSips…</p>
      </div>
    );
  }
  if (isSignedIn) return <Navigate to="/" replace />;

  return (
    <div className="auth-layout">
      <PublicNav />
      <div className="auth-page">
        <div className="auth-card clerk-card">
          <div className="auth-brand">
            <h1>SafeSips</h1>
          </div>
          <p className="auth-tagline">Sign in to your safety map.</p>
          <SignIn
            routing="hash"
            signUpUrl="/register"
            fallbackRedirectUrl="/"
          />
          <p className="auth-alt">
            Not ready yet? <Link to="/waitlist">Join the waitlist</Link>
          </p>
          <p className="auth-emergency">
            In an emergency call <strong>112</strong>. See{" "}
            <Link to="/help">spiking first-aid info</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}
