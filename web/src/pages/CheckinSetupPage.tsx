import { useCallback, useEffect, useState } from "react";
import type { ContactsOverviewDTO, PlanDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import NotificationsCard from "../components/NotificationsCard";
import { timeUntil } from "../format";
import { useSocket } from "../socket/SocketProvider";

export default function CheckinSetupPage() {
  const { socket } = useSocket();
  const [overview, setOverview] = useState<ContactsOverviewDTO | null>(null);
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [o, p] = await Promise.all([api.contacts(), api.listPlans()]);
      setOverview(o);
      setPlans(p);
      setLoadError(null);
    } catch {
      setLoadError("Couldn't load your check-in settings.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // A request arrived / was accepted / removed by the other person.
  useEffect(() => {
    if (!socket) return;
    const onChanged = () => void load();
    socket.on("contacts:changed", onChanged);
    return () => {
      socket.off("contacts:changed", onChanged);
    };
  }, [socket, load]);

  const hasAccepted = !!overview?.contacts.some((c) => c.status === "accepted");

  return (
    <div className="page checkin-page">
      <div className="page-head">
        <h1>Check-ins &amp; SOS</h1>
      </div>
      <p className="muted">
        Going somewhere unfamiliar? Set up check-ins. SafeSips sends you a
        notification with a personal question on a schedule — you need to be
        clear-headed enough to answer. Miss it, and{" "}
        <strong>your emergency contacts are alerted in SafeSips</strong>, with
        your approximate area if you're sharing your location at the time.
      </p>
      {loadError && <p className="error">{loadError}</p>}

      <NotificationsCard why="You'll get your check-in prompts here — and alerts if someone you protect misses theirs." />

      {overview && (
        <EmergencyContactsSection overview={overview} onChange={setOverview} />
      )}
      <CheckinPlansSection plans={plans} hasPrimary={hasAccepted} onChange={load} />
    </div>
  );
}

function EmergencyContactsSection({
  overview,
  onChange,
}: {
  overview: ContactsOverviewDTO;
  onChange: (o: ContactsOverviewDTO) => void;
}) {
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = async (fn: () => Promise<ContactsOverviewDTO>) => {
    setError(null);
    try {
      onChange(await fn());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const r = await api.addContact(identifier);
      setMessage(r.message);
      setIdentifier("");
      onChange(r.overview);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't send the request.");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(overview.myCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked: the code is visible to copy by hand */
    }
  };

  return (
    <section className="card">
      <h2>Emergency contacts</h2>
      <p className="muted">
        Your emergency contacts are other SafeSips users. They're alerted in the
        app if you miss a check-in — after they accept your request.
      </p>

      <p className="my-code">
        Your SafeSips code: <strong className="code-chip">{overview.myCode}</strong>{" "}
        <button className="btn btn-ghost btn-sm" type="button" onClick={copyCode}>
          {copied ? "Copied" : "Copy"}
        </button>
        <span className="field-hint"> Give it to people who want to add you.</span>
      </p>

      {overview.incoming.length > 0 && (
        <div className="contact-requests" role="region" aria-label="Requests for you">
          <h3>Requests for you</h3>
          <ul className="contact-list">
            {overview.incoming.map((r) => (
              <li key={r.id} className="contact-row">
                <span>
                  <strong>{r.fromDisplayName}</strong> wants you as their emergency contact.
                </span>
                <span className="contact-actions">
                  <button className="btn btn-primary btn-sm" type="button" onClick={() => run(() => api.acceptContact(r.id))}>
                    Accept
                  </button>
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(() => api.removeContact(r.id))}>
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3>Your contacts</h3>
      {overview.contacts.length === 0 ? (
        <p className="muted">No contacts yet. Add someone by their email or SafeSips code.</p>
      ) : (
        <ul className="contact-list">
          {overview.contacts.map((c) => (
            <li key={c.id} className="contact-row">
              <span>
                <strong>{c.displayName ?? c.inviteLabel}</strong>
                {c.status === "accepted" ? (
                  <span className="pill pill-primary">Accepted</span>
                ) : (
                  <span className="pill pill-paused">Waiting for them to accept</span>
                )}
                {c.displayName && <span className="muted"> {c.inviteLabel}</span>}
              </span>
              <span className="contact-actions">
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(() => api.removeContact(c.id))}>
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <form className="inline-form" onSubmit={add}>
        <input
          placeholder="Their email or SafeSips code"
          aria-label="Their email or SafeSips code"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoCapitalize="none"
          autoCorrect="off"
          required
        />
        <button className="btn btn-secondary btn-sm" disabled={busy} type="submit">
          {busy ? "Sending…" : "Send request"}
        </button>
      </form>
      {message && <p className="hint" role="status">{message}</p>}
      {error && <p className="error">{error}</p>}

      {overview.protecting.length > 0 && (
        <>
          <h3>You're an emergency contact for</h3>
          <ul className="contact-list">
            {overview.protecting.map((p) => (
              <li key={p.id} className="contact-row">
                <span>
                  <strong>{p.displayName}</strong>
                  <span className="muted"> — you'll be alerted if they miss a check-in</span>
                </span>
                <span className="contact-actions">
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => run(() => api.removeContact(p.id))}>
                    Stop
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
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
        <p className="hint">
          Add an emergency contact above — and wait for them to accept — before
          starting a plan.
        </p>
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
