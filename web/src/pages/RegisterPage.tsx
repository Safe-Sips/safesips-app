import { SignUp, useAuth as useClerkAuth } from "@clerk/react";
import { Navigate } from "react-router-dom";

/** Just Clerk's sign-up form, centred on the page. */
export default function RegisterPage() {
  const { isLoaded, isSignedIn } = useClerkAuth();

  if (isLoaded && isSignedIn) return <Navigate to="/" replace />;

  return (
    <main className="auth-page" id="main">
      <div className="clerk-card">
        {isLoaded ? (
          <SignUp routing="hash" signInUrl="/login" fallbackRedirectUrl="/" />
        ) : (
          <p className="auth-loading" role="status">
            Loading sign-up…
          </p>
        )}
      </div>
    </main>
  );
}
