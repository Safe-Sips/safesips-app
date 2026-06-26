import { NavLink } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const LINKS = [
  { to: "/", label: "Map", end: true },
  { to: "/forum", label: "Forum", end: false },
  { to: "/checkins", label: "Check-in", end: false },
  { to: "/first-aid", label: "First aid", end: false },
];

export default function NavBar() {
  const { user, logout } = useAuth();
  return (
    <header className="nav">
      <div className="nav-brand">
        <span className="nav-title">SafeSips</span>
      </div>
      <nav className="nav-links" aria-label="Primary">
        {LINKS.map((l) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `nav-link${isActive ? " is-active" : ""}`
            }
          >
            {l.label}
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
              <span className="nav-dot" title="Email not verified" aria-hidden>
                ●
              </span>
            )}
          </NavLink>
        )}
        <button className="btn btn-ghost btn-sm" onClick={() => logout()}>
          Log out
        </button>
      </div>
    </header>
  );
}
