import { SignIn, useAuth as useClerkAuth } from "@clerk/react";
import { Navigate } from "react-router-dom";
import EmergencyHelpLink from "../components/EmergencyHelpLink";

/** Just Clerk's sign-in form, centred on the page. */
export default function LoginPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (isLoaded && isSignedIn) return <Navigate to="/" replace />;

  return (
    <main className="auth-page" id="main">
      <div className="clerk-card">
        {isLoaded ? (
          <SignIn routing="hash" signUpUrl="/register" fallbackRedirectUrl="/" />
        ) : (
          <p className="auth-loading" role="status">
            Loading sign-in…
          </p>
        )}
        <EmergencyHelpLink />
      </div>
    </main>
  );
}
