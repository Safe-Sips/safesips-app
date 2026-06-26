import { useState } from "react";
import { Outlet } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth/AuthContext";
import { SocketProvider } from "../socket/SocketProvider";
import ActiveCheckinModal from "./ActiveCheckinModal";
import NavBar from "./NavBar";

function VerifyBanner() {
  const { user, refresh } = useAuth();
  const [sent, setSent] = useState(false);
  const [devUrl, setDevUrl] = useState<string | null>(null);
  if (!user || user.emailVerified) return null;
  return (
    <div className="verify-banner">
      <span>
        Verify your email to report locations and post in the forum.
      </span>
      <span className="verify-banner-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            try {
              const res = await api.resendVerification();
              setSent(true);
              if (res.verifyUrl) setDevUrl(res.verifyUrl);
            } catch {
              setSent(true);
            }
          }}
        >
          {sent ? "Sent ✓" : "Resend link"}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => refresh()}>
          I've verified
        </button>
      </span>
      {devUrl && (
        <a className="verify-banner-dev" href={devUrl}>
          Dev: open verification link
        </a>
      )}
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
