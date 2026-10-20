import { SignUp, useAuth as useClerkAuth } from "@clerk/react";
import { Link, Navigate } from "react-router-dom";
import AuthIntro from "../components/AuthIntro";
import PublicNav from "../components/PublicNav";
import { EMERGENCY_NUMBER } from "../content/firstAid";

export default function RegisterPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (isLoaded && isSignedIn) return <Navigate to="/" replace />;

  return (
    <div className="auth-layout">
      <PublicNav />
      <main className="auth-page auth-page-split" id="main">
        <AuthIntro />
        <div className="auth-card clerk-card">
          <div className="auth-brand">
            <h1>SafeSips</h1>
          </div>
          <p className="auth-tagline">Create your SafeSips account.</p>
          {isLoaded ? (
            <SignUp routing="hash" signInUrl="/login" fallbackRedirectUrl="/" />
          ) : (
            <p className="auth-loading" role="status">
              Loading sign-up…
            </p>
          )}
          <p className="auth-emergency">
            In an emergency call <strong>{EMERGENCY_NUMBER}</strong>. See{" "}
            <Link to="/help">spiking first-aid info</Link>.
          </p>
        </div>
      </main>
    </div>
  );
}
