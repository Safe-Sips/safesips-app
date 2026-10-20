import { Link } from "react-router-dom";

/**
 * What SafeSips is and why to trust it, shown to logged-out visitors next to
 * the sign-in / sign-up form. Renders without Clerk or the API, so it (and the
 * first-aid link) still shows if sign-in is slow or the device is offline.
 */
export default function AuthIntro() {
  return (
    <section className="auth-intro" aria-labelledby="auth-intro-title">
      <p className="auth-intro-eyebrow">Your best party friend</p>
      <h2 id="auth-intro-title">
        Let friends know roughly where you are — never exactly.
      </h2>
      <ul className="auth-intro-list">
        <li>
          <span className="auth-intro-icon" aria-hidden="true">
            🔒
          </span>
          <span>
            <strong>Your exact location never leaves your device.</strong>{" "}
            Others only see an anonymous ~200 m circle around a random point
            near you.
          </span>
        </li>
        <li>
          <span className="auth-intro-icon" aria-hidden="true">
            📍
          </span>
          <span>See and report safe and unsafe places around you.</span>
        </li>
        <li>
          <span className="auth-intro-icon" aria-hidden="true">
            ⏱️
          </span>
          <span>
            Set check-ins: if you don't answer one, a trusted contact gets an
            email asking them to check on you.
          </span>
        </li>
        <li>
          <span className="auth-intro-icon" aria-hidden="true">
            🆘
          </span>
          <span>
            Think you've been spiked?{" "}
            <Link to="/help">Open first-aid info</Link> — no account needed.
          </span>
        </li>
      </ul>
    </section>
  );
}
