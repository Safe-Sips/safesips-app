import { Suspense } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PresenceProvider } from "../hooks/usePresence";
import { SocketProvider } from "../socket/SocketProvider";
import ActiveCheckinModal from "./ActiveCheckinModal";
import NavBar from "./NavBar";

function VerifyBanner() {
  const { user, refresh } = useAuth();
  if (!user || user.emailVerified) return null;
  return (
    <div className="verify-banner">
      <span>
        Verify your email in the account menu to report locations and post in
        the forum.
      </span>
      <span className="verify-banner-actions">
        <button className="btn btn-ghost btn-sm" onClick={() => refresh()}>
          I've verified
        </button>
      </span>
    </div>
  );
}

export default function AppShell() {
  return (
    <SocketProvider>
      <PresenceProvider>
        <div className="shell">
          <a className="skip-link" href="#main">
            Skip to main content
          </a>
          <NavBar />
          <VerifyBanner />
          <main className="shell-main" id="main" tabIndex={-1}>
            {/* Pages are lazy chunks; keep the nav on screen while one loads. */}
            <Suspense
              fallback={
                <div className="page-loading" role="status">
                  Loading…
                </div>
              }
            >
              <Outlet />
            </Suspense>
          </main>
          <ActiveCheckinModal />
        </div>
      </PresenceProvider>
    </SocketProvider>
  );
}
