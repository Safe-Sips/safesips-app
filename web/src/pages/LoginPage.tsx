import { SignIn, useAuth as useClerkAuth } from "@clerk/react";
import { Link, Navigate } from "react-router-dom";
import AuthIntro from "../components/AuthIntro";
import PublicNav from "../components/PublicNav";
import { EMERGENCY_NUMBER } from "../content/firstAid";

export default function LoginPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (isLoaded && isSignedIn) return <Navigate to="/" replace />;

  // The intro and emergency info render right away; only the Clerk form
  // waits for Clerk, so a slow or offline load never hides how to get help.
  return (
    <div className="auth-layout">
      <PublicNav />
      <main className="auth-page auth-page-split" id="main">
        <AuthIntro />
        <div className="auth-card clerk-card">
          <div className="auth-brand">
            <h1>SafeSips</h1>
          </div>
          <p className="auth-tagline">Sign in to your safety map.</p>
          {isLoaded ? (
            <SignIn routing="hash" signUpUrl="/register" fallbackRedirectUrl="/" />
          ) : (
            <p className="auth-loading" role="status">
              Loading sign-in…
            </p>
          )}
          <p className="auth-alt">
            Not ready yet? <Link to="/waitlist">Join the waitlist</Link>
          </p>
          <p className="auth-emergency">
            In an emergency call <strong>{EMERGENCY_NUMBER}</strong>. See{" "}
            <Link to="/help">spiking first-aid info</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
