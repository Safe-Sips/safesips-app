import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import {
  DISCLAIMER,
  EMERGENCY_NUMBER,
  FIRST_EFFECTS,
  FIRST_STEPS,
  HELP_SOMEONE,
} from "../content/firstAid";

export default function FirstAidPage() {
  const { user } = useAuth();
  return (
    <div className="page firstaid-page">
      <div className="page-head">
        <Link className="back-link" to={user ? "/" : "/login"}>
          {user ? "← Back to map" : "← Back to login"}
        </Link>
        <h1>If you've been spiked</h1>
      </div>

      <a className="emergency-call" href={`tel:${EMERGENCY_NUMBER}`}>
        🚨 Emergency? Call {EMERGENCY_NUMBER} now
      </a>

      <section className="card">
        <h2>First effects to watch for</h2>
        <p className="muted">
          Spiking can come on fast. Trust your body — if something feels wrong,
          act early.
        </p>
        <ul className="effects-list">
          {FIRST_EFFECTS.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>What to do first</h2>
        <ol className="steps-list">
          {FIRST_STEPS.map((s, i) => (
            <li key={s.title}>
              <span className="step-num">{i + 1}</span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>Helping someone else</h2>
        <ul className="help-list">
          {HELP_SOMEONE.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <p>{s.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="card card-quiet">
        <p className="muted">{DISCLAIMER}</p>
        <p className="muted">
          Tip: if you mark a place as <strong>unsafe</strong> on the map,
          SafeSips immediately shows nearby help — police, hospital, pharmacy,
          fuel stations and 24/7 spots.
        </p>
      </section>
    </div>
  );
}
