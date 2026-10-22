import { useCallback, useEffect, useState } from "react";
import type { ContactsOverviewDTO, PlanContactDTO, PlanDTO } from "@safesips/shared";
import { api, ApiError } from "../api";
import ContactPicker from "../components/ContactPicker";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { timeUntil } from "../format";
import { useSocket } from "../socket/SocketProvider";
import MoreInfo from "../components/MoreInfo";

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

  // Accepted contacts are the ones a check-in can alert.
  const acceptedContacts: PlanContactDTO[] = (overview?.contacts ?? [])
    .filter((c) => c.status === "accepted" && c.userId)
    .map((c) => ({ userId: c.userId!, displayName: c.displayName ?? c.inviteLabel }));

  return (
    <div className="page checkin-page">
      <div className="page-head">
        <h1>Check-ins &amp; SOS</h1>
      </div>
      <p className="muted">
        SafeSips asks you a question on a schedule. Miss one and{" "}
        <strong>your emergency contacts are alerted</strong>.
      </p>
      <MoreInfo label="How it works">
        Pick a question you need a clear head to answer. Alerts reach your contacts in SafeSips,
        with your approximate area if you're sharing your location.
      </MoreInfo>
      {loadError && <p className="error">{loadError}</p>}

      {overview && (
        <EmergencyContactsSection overview={overview} onChange={setOverview} />
      )}
      <CheckinPlansSection plans={plans} contacts={acceptedContacts} onChange={load} />
    </div>
  );
}

/** "Saved to your account": these contacts come back after a server reset. */
function BackupNote({ overview }: { overview: ContactsOverviewDTO }) {
  const [saved, setSaved] = useState<{ contacts: number; protecting: number } | null>(null);
  useEffect(() => {
    let active = true;
    api
      .backupStatus()
      .then((r) => active && setSaved(r.saved))
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [overview]);
  if (!saved || saved.contacts + saved.protecting === 0) return null;
  const parts = [
    saved.contacts > 0 && `${saved.contacts} ${saved.contacts === 1 ? "contact" : "contacts"}`,
    saved.protecting > 0 && `${saved.protecting} ${saved.protecting === 1 ? "person" : "people"} you look out for`,
  ].filter(Boolean);
  return (
    <p className="field-hint backup-note">
      ✓ Saved to your account ({parts.join(", ")}), kept through app updates.
    </p>
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

  const run = async (fn: () => Promise<ContactsOverviewDTO>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
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

  return (
    <section className="card">
      <h2>Emergency contacts</h2>

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
        <p className="muted">No contacts yet. Add someone by their email, or from a friend's profile.</p>
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
                <button
                  className="btn btn-ghost btn-sm"
                  type="button"
                  onClick={() =>
                    run(
                      () => api.removeContact(c.id),
                      c.status === "accepted"
                        ? `Remove ${c.displayName ?? "this contact"}? They won't be alerted if you miss a check-in.`
                        : undefined
                    )
                  }
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      <BackupNote overview={overview} />

      <form className="inline-form" onSubmit={add}>
        <input
          type="email"
          placeholder="Their email"
          aria-label="Their email"
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
                  <span className="muted"> · you're alerted if they miss a check-in</span>
                </span>
                <span className="contact-actions">
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() =>
                      run(
                        () => api.removeContact(p.id),
                        `Stop being ${p.displayName}'s emergency contact? You won't be alerted if they miss a check-in.`
                      )
                    }
                  >
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

// 1 minute is for trying the feature out: prompts every minute, and contacts
// are alerted every minute while you don't answer.
const INTERVAL_OPTIONS = [1, 10, 15, 30, 60, 90, 120];
const GRACE_OPTIONS = [1, 5, 10, 15, 20];
const minutesLabel = (m: number) => (m === 1 ? "1 minute" : `${m} minutes`);

/** "Everyone" or the names a plan alerts. */
function alertsLabel(p: PlanDTO): string {
  return p.alertContacts ? p.alertContacts.map((c) => c.displayName).join(", ") : "everyone";
}

/** Inline "who does this running check-in alert?" editor. */
function PlanContactsEditor({
  plan,
  contacts,
  onSaved,
}: {
  plan: PlanDTO;
  contacts: PlanContactDTO[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="muted plan-alerts">
        Alerts: {alertsLabel(plan)}{" "}
        {contacts.length > 1 && (
          <button
            className="btn-link"
            type="button"
            onClick={() => {
              setSelected(plan.alertContacts ? plan.alertContacts.map((c) => c.userId) : null);
              setError(null);
              setOpen(true);
            }}
          >
            Change
          </button>
        )}
      </div>
    );
  }
  const save = async () => {
    if (selected !== null && selected.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await api.setPlanContacts(plan.id, selected);
      setOpen(false);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="plan-alerts-edit">
      <ContactPicker contacts={contacts} selected={selected} onChange={setSelected} />
      <div className="data-actions">
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={busy || (selected !== null && selected.length === 0)}
          onClick={save}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function CheckinPlansSection({
  plans,
  contacts,
  onChange,
}: {
  plans: PlanDTO[];
  contacts: PlanContactDTO[];
  onChange: () => void;
}) {
  const hasPrimary = contacts.length > 0;
  // null = everyone (the default).
  const [alertIds, setAlertIds] = useState<string[] | null>(null);
  const [label, setLabel] = useState("");
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [graceMinutes, setGraceMinutes] = useState(10);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [autoStopHours, setAutoStopHours] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const push = usePushNotifications();

  const planAction = async (fn: () => Promise<unknown>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setPlanError(null);
    try {
      await fn();
    } catch (err) {
      setPlanError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
    }
    onChange();
  };

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
    setNotice(null);
    if (alertIds !== null && alertIds.length === 0) {
      setError("Pick at least one contact to alert.");
      return;
    }
    // Reminders arrive as notifications. If they're off, ask now: this has to
    // be the first thing after the tap, or the browser won't show the prompt.
    let pushNow = push.status;
    if (pushNow === "off") pushNow = await push.enable();
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
        // Only send a selection if it's a real subset of the current contacts.
        contactUserIds: alertIds?.filter((id) => contacts.some((c) => c.userId === id)) ?? null,
      });
      setLabel("");
      setAlertIds(null);
      setQuestion("");
      setAnswer("");
      setAutoStopHours("");
      if (pushNow !== "on" && pushNow !== "loading" && pushNow !== "unavailable") {
        setNotice(
          "Check-ins started, but notifications are off on this device, so you'll only be reminded while SafeSips is open."
        );
      }
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't start check-ins. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <h2>Your check-ins</h2>
      {planError && <p className="error">{planError}</p>}
      {plans.length === 0 ? (
        <p className="muted">No check-ins running.</p>
      ) : (
        <ul className="plan-list">
          {plans.map((p) => (
            <li key={p.id} className="plan-row">
              <div>
                <strong>{p.label || "Check-in"}</strong>{" "}
                <span className={`pill pill-${p.status}`}>{p.status === "paused" ? "Paused" : "Active"}</span>
                <div className="muted">
                  Every {minutesLabel(p.intervalMinutes)} · {minutesLabel(p.graceMinutes)} to answer
                  {p.nextDueAt ? ` · next in ${timeUntil(p.nextDueAt)}` : ""}
                </div>
                <div className="muted">“{p.question}”</div>
                <PlanContactsEditor plan={p} contacts={contacts} onSaved={onChange} />
              </div>
              <div className="plan-actions">
                {p.status === "active" ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => planAction(() => api.pausePlan(p.id))}>
                    Pause
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-sm" onClick={() => planAction(() => api.resumePlan(p.id))}>
                    Resume
                  </button>
                )}
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => planAction(() => api.endPlan(p.id), "End this check-in? You won't get any more reminders for it.")}
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
          Add an emergency contact above and wait for them to accept before you
          start a check-in.
        </p>
      )}

      <form className="card-form" onSubmit={create}>
        <h3>Start a new check-in</h3>
        <label className="field">
          <span>Label (optional)</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. Night out in town"
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Check in every</span>
            <select
              value={intervalMinutes}
              onChange={(e) => {
                const next = Number(e.target.value);
                setIntervalMinutes(next);
                // Time to answer can't be longer than the interval.
                setGraceMinutes((g) => Math.min(g, next));
              }}
            >
              {INTERVAL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                  {m === 1 ? " (for testing)" : ""}
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
              {GRACE_OPTIONS.filter((m) => m <= intervalMinutes).map((m) => (
                <option key={m} value={m}>
                  {minutesLabel(m)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Stop after (hours)</span>
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
          <span>Answer (kept private, never stored as plain text)</span>
          <input
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            required
          />
          <small className="field-hint">
            Capital letters and spaces don't matter.
          </small>
        </label>
        {contacts.length > 1 && (
          <ContactPicker contacts={contacts} selected={alertIds} onChange={setAlertIds} />
        )}
        {error && <p className="error">{error}</p>}
        <PushHint status={push.status} />
        <button
          className="btn btn-primary"
          disabled={busy || push.busy || !hasPrimary || (alertIds !== null && alertIds.length === 0)}
          type="submit"
        >
          {busy || push.busy ? "Starting…" : "Start check-ins"}
        </button>
        {notice && <p className="hint" role="status">{notice}</p>}
      </form>
    </section>
  );
}

/**
 * Next to "Start check-ins": what to expect from notifications on this
 * device. When they're simply off there's nothing to say: tapping Start asks.
 */
function PushHint({ status }: { status: ReturnType<typeof usePushNotifications>["status"] }) {
  if (status === "denied") {
    return (
      <p className="hint">
        Notifications are blocked for SafeSips, so you'll only be reminded while it's open. To allow
        them, open your phone or browser settings → Notifications → SafeSips.
      </p>
    );
  }
  if (status === "needs-install") {
    return (
      <p className="hint">
        On iPhone, reminders only arrive once SafeSips is on your Home Screen: tap <strong>Share</strong> →{" "}
        <strong>Add to Home Screen</strong> and open it from there.
      </p>
    );
  }
  return null;
}
