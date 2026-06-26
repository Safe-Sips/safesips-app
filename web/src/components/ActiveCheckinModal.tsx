import { useEffect, useState } from "react";
import { useCheckins } from "../hooks/useCheckins";
import { timeUntil } from "../format";

export default function ActiveCheckinModal() {
  const { active, answer } = useCheckins();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  // Tick every second so the countdown updates.
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [active]);

  // Reset the form when a new check-in appears.
  useEffect(() => {
    setValue("");
    setError(null);
  }, [active?.id]);

  if (!active) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await answer(active.id, value);
      if (res.expired) {
        setError("This check-in expired — your SOS contact may have been alerted.");
      } else if (!res.correct) {
        setError("That doesn't match. Try again.");
      }
    } catch {
      setError("Couldn't submit. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop checkin-backdrop" role="dialog" aria-modal="true">
      <div className="modal-card checkin-card">
        <h2>SafeSips check-in</h2>
        <p className="muted">
          Answer your security question to confirm you're OK. If you don't answer
          in time, your primary SOS contact will be notified to check on you.
        </p>
        <p className="checkin-deadline">
          Time left: <strong>{timeUntil(active.deadlineAt)}</strong>
        </p>
        <form onSubmit={submit}>
          <label className="field">
            <span>{active.question}</span>
            <input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoFocus
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary btn-block" disabled={busy} type="submit">
            {busy ? "Checking…" : "I'm OK — submit"}
          </button>
        </form>
      </div>
    </div>
  );
}
