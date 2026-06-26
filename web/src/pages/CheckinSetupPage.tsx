import { useCallback, useEffect, useState } from "react";
import type { PlanDTO, SosContactDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import { timeUntil } from "../format";

export default function CheckinSetupPage() {
  const [contacts, setContacts] = useState<SosContactDTO[]>([]);
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([api.listContacts(), api.listPlans()]);
      setContacts(c);
      setPlans(p);
    } catch {
      setLoadError("Couldn't load your check-in settings.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="page checkin-page">
      <div className="page-head">
        <h1>Check-ins &amp; SOS</h1>
      </div>
      <p className="muted">
        Going somewhere unfamiliar? Set up check-ins. SafeSips will ask you a
        personal question on a schedule — you need to be clear-headed enough to
        answer. Miss it, and your primary SOS contact is alerted to check on you.
        <strong> Keep the app open so you receive the prompt.</strong>
      </p>
      {loadError && <p className="error">{loadError}</p>}

      <SosContactsSection contacts={contacts} onChange={load} />
      <CheckinPlansSection
        plans={plans}
        hasPrimary={contacts.some((c) => c.isPrimary)}
        onChange={load}
      />
    </div>
  );
}

function SosContactsSection({
  contacts,
  onChange,
}: {
  contacts: SosContactDTO[];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.createContact({
        name,
        email: email || undefined,
        phone: phone || undefined,
        isPrimary,
      });
      setName("");
      setEmail("");
      setPhone("");
      setIsPrimary(false);
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add contact.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>SOS contacts</h2>
      {contacts.length === 0 ? (
        <p className="muted">No contacts yet. Add at least one primary contact.</p>
      ) : (
        <ul className="contact-list">
          {contacts.map((c) => (
            <li key={c.id} className="contact-row">
              <span>
                <strong>{c.name}</strong>
                {c.isPrimary && <span className="pill pill-primary">Primary</span>}
                <span className="muted">
                  {" "}
                  {c.phone ?? c.email}
                </span>
              </span>
              <button
                className="btn btn-ghost btn-sm"
                onClick={async () => {
                  await api.deleteContact(c.id);
                  onChange();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className="inline-form" onSubmit={add}>
        <input
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <input
          placeholder="Email (optional)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          placeholder="Phone (optional)"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={isPrimary}
            onChange={(e) => setIsPrimary(e.target.checked)}
          />
          Primary
        </label>
        <button className="btn btn-secondary btn-sm" disabled={busy} type="submit">
          {busy ? "Adding…" : "Add contact"}
        </button>
      </form>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function CheckinPlansSection({
  plans,
  hasPrimary,
  onChange,
}: {
  plans: PlanDTO[];
  hasPrimary: boolean;
  onChange: () => void;
}) {
  const [label, setLabel] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [graceMinutes, setGraceMinutes] = useState(10);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [autoStopHours, setAutoStopHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);

  // Tick every second so each plan's "next in" countdown updates live.
  const hasCountdown = plans.some((p) => p.nextDueAt);
  useEffect(() => {
    if (!hasCountdown) return;
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, [hasCountdown]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const hours = Number(autoStopHours);
      const endsAt =
        autoStopHours && Number.isFinite(hours) && hours > 0
          ? Date.now() + hours * 3_600_000
          : undefined;
      await api.createPlan({
        label: label || undefined,
        intervalMinutes,
        graceMinutes,
        question,
        answer,
        endsAt,
      });
      setLabel("");
      setQuestion("");
      setAnswer("");
      setAutoStopHours("");
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not start check-ins.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Active check-in plans</h2>
      {plans.length === 0 ? (
        <p className="muted">No active plans.</p>
      ) : (
        <ul className="plan-list">
          {plans.map((p) => (
            <li key={p.id} className="plan-row">
              <div>
                <strong>{p.label || "Check-in"}</strong>{" "}
                <span className={`pill pill-${p.status}`}>{p.status}</span>
                <div className="muted">
                  Every {p.intervalMinutes} min · {p.graceMinutes} min to answer
                  {p.nextDueAt ? ` · next in ${timeUntil(p.nextDueAt)}` : ""}
                </div>
                <div className="muted">“{p.question}”</div>
              </div>
              <div className="plan-actions">
                {p.status === "active" && (
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={async () => {
                      await api.pausePlan(p.id);
                      onChange();
                    }}
                  >
                    Pause
                  </button>
                )}
                <button
                  className="btn btn-danger btn-sm"
                  onClick={async () => {
                    await api.endPlan(p.id);
                    onChange();
                  }}
                >
                  End
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {!hasPrimary && (
        <p className="hint">Add a primary SOS contact above before starting a plan.</p>
      )}

      <form className="card-form" onSubmit={create}>
        <h3>Start a new check-in</h3>
        <label className="field">
          <span>Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Night out downtown"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Check in every</span>
            <select
              value={intervalMinutes}
              onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            >
              {[30, 60, 90, 120].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Time to answer</span>
            <select
              value={graceMinutes}
              onChange={(e) => setGraceMinutes(Number(e.target.value))}
            >
              {[5, 10, 15, 20].map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Auto-stop after (h)</span>
            <input
              type="number"
              min={1}
              max={24}
              value={autoStopHours}
              onChange={(e) => setAutoStopHours(e.target.value)}
              placeholder="optional"
            />
          </label>
        </div>
        <label className="field">
          <span>Security question</span>
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What's my dog's name?"
            minLength={3}
            required
          />
        </label>
        <label className="field">
          <span>Answer (kept private, hashed)</span>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
          />
          <small className="field-hint">
            Case and spacing don't matter when you answer.
          </small>
        </label>
        {error && <p className="error">{error}</p>}
        <button
          className="btn btn-primary"
          disabled={busy || !hasPrimary}
          type="submit"
        >
          {busy ? "Starting…" : "Start check-ins"}
        </button>
      </form>
    </section>
  );
}
