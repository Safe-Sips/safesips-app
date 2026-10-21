import { NavLink } from "react-router-dom";
import ClerkAuthControls from "../auth/ClerkAuthControls";
import { useAuth } from "../auth/AuthContext";
import { useAlerts } from "../hooks/useAlerts";

const LINKS = [
  { to: "/", label: "Map", end: true },
  { to: "/forum", label: "Forum", end: false },
  { to: "/checkins", label: "Check-in", end: false },
  { to: "/friends", label: "Friends", end: false },
  { to: "/alerts", label: "Alerts", end: false },
  { to: "/first-aid", label: "First aid", end: false },
];

export default function NavBar() {
  const { user } = useAuth();
  const { unread } = useAlerts();
  return (
    <header className="nav">
      <nav className="nav-links" aria-label="Primary">
        {[...LINKS, ...(user?.isAdmin ? [{ to: "/admin", label: "Moderation", end: false }] : [])].map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `nav-link${isActive ? " is-active" : ""}`
            }
          >
            {l.label}
            {l.to === "/alerts" && unread > 0 && (
              <span className="nav-badge" aria-label={`${unread} new`}>
                {unread}
              </span>
            )}
          </NavLink>
        ))}
      </nav>
      <div className="nav-user">
        {user && (
          <NavLink
            to="/profile"
            title="Your profile"
            className={({ isActive }) =>
              `nav-name${isActive ? " is-active" : ""}`
            }
          >
            {user.displayName}
            {!user.emailVerified && (
              <>
                <span className="nav-dot" title="Email not verified" aria-hidden>
                  ●
                </span>
                <span className="sr-only"> (email not verified)</span>
              </>
            )}
          </NavLink>
        )}
        <ClerkAuthControls />
      </div>
    </header>
  );
}
