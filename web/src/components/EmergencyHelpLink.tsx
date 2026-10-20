import { Link } from "react-router-dom";
import { EMERGENCY_NUMBER } from "../content/firstAid";

/** One quiet line under the sign-in/up form: help must never need an account. */
export default function EmergencyHelpLink() {
  return (
    <p className="auth-emergency auth-emergency-quiet">
      Emergency? Call <a href={`tel:${EMERGENCY_NUMBER}`}>{EMERGENCY_NUMBER}</a> ·{" "}
      <Link to="/help">Spiking first-aid</Link>
    </p>
  );
}
