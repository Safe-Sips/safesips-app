import { usePushNotifications } from "../hooks/usePushNotifications";

/** Turn SafeSips notifications on/off for this device, with honest guidance. */
export default function NotificationsCard({ why }: { why: string }) {
  const { status, busy, error, enable, disable } = usePushNotifications();
  if (status === "loading") return null;

  return (
    <section className={`card notif-card${status === "on" ? "" : " notif-off"}`}>
      <h2>Notifications on this device</h2>
      <p className="muted">{why}</p>

      {status === "on" && (
        <p className="notif-state notif-on">
          <span aria-hidden="true">✓ </span>On for this device.{" "}
          <button className="legal-link" type="button" onClick={disable} disabled={busy}>
            Turn off
          </button>
        </p>
      )}
      {status === "off" && (
        <button className="btn btn-primary" type="button" onClick={enable} disabled={busy}>
          {busy ? "Turning on…" : "Turn on notifications"}
        </button>
      )}
      {status === "denied" && (
        <p className="error">
          Notifications are blocked for SafeSips. Allow them in your browser (tap the
          lock or info icon next to the address → Notifications), then reload the page.
        </p>
      )}
      {status === "needs-install" && (
        <p className="error">
          On iPhone, notifications only work once SafeSips is on your Home Screen. Tap{" "}
          <strong>Share</strong> → <strong>Add to Home Screen</strong>, open SafeSips from
          there, then turn notifications on.
        </p>
      )}
      {status === "unsupported" && (
        <p className="error">
          This browser can't show SafeSips notifications. Try an up-to-date Chrome,
          Edge, Firefox or Safari.
        </p>
      )}
      {status === "unavailable" && (
        <p className="hint">
          Notifications aren't available in this version of the app.
        </p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}
