import { Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
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
      <div className="shell">
        <NavBar />
        <VerifyBanner />
        <main className="shell-main">
          <Outlet />
        </main>
        <ActiveCheckinModal />
      </div>
    </SocketProvider>
  );
}
