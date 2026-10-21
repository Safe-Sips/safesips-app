import { Suspense, useState } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { PresenceProvider } from "../hooks/usePresence";
import { AlertsProvider, useAlerts } from "../hooks/useAlerts";
import { SocketProvider } from "../socket/SocketProvider";
import ActiveCheckinModal from "./ActiveCheckinModal";
import NavBar from "./NavBar";

function VerifyBanner() {
  const { user, refresh } = useAuth();
  if (!user || user.emailVerified) return null;
  return (
    <div className="verify-banner">
      <span>
        Verify your email (in your account menu) to post reports and join
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

/**
 * Shown once to everyone (including people who joined before friend search):
 * by default others can find you by name. Either button records the choice.
 */
function SearchNoticeBanner() {
  const { user, patchUser } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!user?.searchNoticePending) return null;
  const choose = async (keepOn: boolean) => {
    setBusy(true);
    try {
      if (keepOn) await api.dismissSearchNotice();
      else await api.setDiscoverable(false);
      patchUser({ searchNoticePending: false, discoverable: keepOn });
    } catch {
      setBusy(false);
    }
  };
  return (
    <div className="verify-banner search-notice" role="status">
      <span>
        <strong>New:</strong> friends can now find you by your name in Friends search (they see your
        name and picture, never your email).
      </span>
      <span className="verify-banner-actions">
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void choose(true)}>
          Keep it on
        </button>
        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void choose(false)}>
          Turn it off
        </button>
      </span>
    </div>
  );
}

/** App-wide: someone you protect missed a check-in and nobody's acted yet. */
function AlertBanner() {
  const { alerts, unread } = useAlerts();
  const { pathname } = useLocation();
  if (unread === 0 || pathname === "/alerts") return null;
  const first = alerts.find((a) => !a.acknowledgedAt);
  return (
    <div className="alert-banner" role="alert">
      <span>
        <span aria-hidden="true">⚠️ </span>
        <strong>{first?.ownerDisplayName ?? "Someone you look out for"}</strong> missed a safety check-in
        {unread > 1 ? ` (+${unread - 1} more)` : ""}.
      </span>
      <Link className="btn btn-sm btn-danger-solid" to="/alerts">
        View alert
      </Link>
    </div>
  );
}

export default function AppShell() {
  return (
    <SocketProvider>
      <PresenceProvider>
        <AlertsProvider>
        <div className="shell">
          <a className="skip-link" href="#main">
            Skip to main content
          </a>
          <NavBar />
          <VerifyBanner />
          <AlertBanner />
          <SearchNoticeBanner />
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
        </AlertsProvider>
      </PresenceProvider>
    </SocketProvider>
  );
}
