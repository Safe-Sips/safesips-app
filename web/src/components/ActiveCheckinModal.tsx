import { useEffect, useState } from "react";
import { useCheckins } from "../hooks/useCheckins";
import { timeUntil } from "../format";
import { useDialogA11y } from "../hooks/useDialogA11y";

export default function ActiveCheckinModal() {
  const { active, answer, dismiss } = useCheckins();
  /** Set once the check-in can no longer be answered (ran out, too many tries). */
  const [closed, setClosed] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  // No Escape: a check-in has to be answered, not dismissed.
  const cardRef = useDialogA11y<HTMLDivElement>(!!active);

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
    setClosed(false);
  }, [active?.id]);

  if (!active) return null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await answer(active.id, value);
      if (res.tooManyAttempts || res.expired) setClosed(true);
      if (res.tooManyAttempts) {
        setError("Too many wrong answers, so your emergency contacts are being alerted now.");
      } else if (res.expired) {
        setError("This check-in has run out, so your emergency contacts may have been alerted.");
      } else if (!res.correct) {
        setError(
          res.attemptsLeft != null && res.attemptsLeft <= 2
            ? `That doesn't match. ${res.attemptsLeft === 1 ? "1 try" : `${res.attemptsLeft} tries`} left before your contacts are alerted.`
            : "That doesn't match. Try again."
        );
      }
    } catch {
      setError("Couldn't send your answer. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop checkin-backdrop">
      <div
        ref={cardRef}
        className="modal-card checkin-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="checkin-title"
        aria-describedby="checkin-desc"
      >
        <h2 id="checkin-title">SafeSips check-in</h2>
        <p className="muted" id="checkin-desc">
          Answer your question to show you're OK. If you don't answer in time,
          your emergency contacts are alerted so they can check on you.
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
              disabled={closed}
              data-autofocus
              required
            />
          </label>
          {error && <p className="error">{error}</p>}
          {closed ? (
            <button className="btn btn-ghost btn-block" type="button" onClick={dismiss}>
              Close
            </button>
          ) : (
            <button className="btn btn-primary btn-block" disabled={busy} type="submit">
              {busy ? "Checking…" : "I'm OK"}
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
