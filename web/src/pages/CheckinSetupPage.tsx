import { useCallback, useEffect, useState } from "react";
import {
  normalizePhone,
  type PlanDTO,
  type SosContactDTO,
  type SosDeliveryDTO,
} from "@safesips/shared";
import { api, ApiError } from "../api";
import { timeUntil } from "../format";

/** Which alert channels this server can really use (or why we don't know). */
type Delivery = SosDeliveryDTO | "loading" | "unknown";

export default function CheckinSetupPage() {
  const [contacts, setContacts] = useState<SosContactDTO[]>([]);
  const [plans, setPlans] = useState<PlanDTO[]>([]);
  const [delivery, setDelivery] = useState<Delivery>("loading");
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
    api
      .sosDelivery()
      .then(setDelivery)
      .catch(() => setDelivery("unknown"));
  }, [load]);

  return (
    <div className="page checkin-page">
      <div className="page-head">
        <h1>Check-ins &amp; SOS</h1>
      </div>
      <p className="muted">
        Going somewhere unfamiliar? Set up check-ins. SafeSips will ask you a
        personal question on a schedule — you need to be clear-headed enough to
        answer. Miss it, and <strong>all your emergency contacts</strong> get a
        text and/or email asking them to check on you — with your approximate
        area if you're sharing your location at the time.
        <strong> Keep the app open so you receive the prompt.</strong>
      </p>
      <AlertStatusBanner delivery={delivery} />
      {loadError && <p className="error">{loadError}</p>}

      <SosContactsSection contacts={contacts} delivery={delivery} onChange={load} />
      <CheckinPlansSection
        plans={plans}
        hasPrimary={contacts.some((c) => !!(c.phone || c.email))}
        onChange={load}
      />
    </div>
  );
}

/**
 * Never let the UI imply a contact will be alerted when the server can't
 * actually send the alert.
 */
function AlertStatusBanner({ delivery }: { delivery: Delivery }) {
  if (delivery === "loading") return null;
  if (delivery === "unknown") {
    return (
      <p className="sos-delivery-banner" role="alert">
        <strong>We couldn't confirm SOS alerts are working.</strong> Don't rely
        on check-ins for your safety until this page loads normally.
      </p>
    );
  }
  if (!delivery.email && !delivery.sms) {
    return (
      <p className="sos-delivery-banner" role="alert">
        <strong>SOS alerts are not active yet.</strong> If you miss a check-in,
        your contacts will <strong>not</strong> be notified. Don't rely on
        check-ins for your safety right now.
      </p>
    );
  }
  if (!delivery.sms) {
    return (
      <p className="hint">
        Text alerts aren't set up on this server yet, so contacts are alerted
        by <strong>email only</strong>. Give each contact an email address.
      </p>
    );
  }
  if (!delivery.email) {
    return (
      <p className="hint">
        Email alerts aren't set up on this server yet, so contacts are alerted
        by <strong>text only</strong>. Give each contact a phone number.
      </p>
    );
  }
  return null;
}

/** How a contact will actually be reached, given what the server supports. */
function reachVia(contact: SosContactDTO, delivery: Delivery): string[] {
  if (typeof delivery === "string") return [];
  const via: string[] = [];
  if (contact.phone && delivery.sms) via.push("text");
  if (contact.email && delivery.email) via.push("email");
  return via;
}

function SosContactsSection({
  contacts,
  delivery,
  onChange,
}: {
  contacts: SosContactDTO[];
  delivery: Delivery;
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const normalized = phone.trim() ? normalizePhone(phone) : null;
  const phoneInvalid = phone.trim() !== "" && normalized === null;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() && !phone.trim()) {
      setError("Add a phone number or an email so we can alert them.");
      return;
    }
    if (phoneInvalid) {
      setError("Enter a valid phone number, e.g. 0722 123 456 or +40 722 123 456.");
      return;
    }
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
      <h2>Emergency contacts</h2>
      <p className="muted">
        Everyone here is alerted if you miss a check-in. Use{" "}
        <strong>Send test alert</strong> to make sure it really reaches them.
      </p>
      {contacts.length === 0 ? (
        <p className="muted">No contacts yet. Add at least one.</p>
      ) : (
        <ul className="contact-list">
          {contacts.map((c) => (
            <ContactRow key={c.id} contact={c} delivery={delivery} onChange={onChange} />
          ))}
        </ul>
      )}

      <form className="inline-form" onSubmit={add}>
        <input
          placeholder="Name"
          aria-label="Contact name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
        />
        <input
          placeholder="Phone, e.g. 0722 123 456"
          aria-label="Phone number (for text alerts)"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          aria-invalid={phoneInvalid}
        />
        <input
          placeholder="Email"
          aria-label="Email (for email alerts)"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
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
      {normalized && <p className="field-hint">Texts will go to {normalized}</p>}
      {phoneInvalid && (
        <p className="error">Use a full number, e.g. 0722 123 456 or +40 722 123 456.</p>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

function ContactRow({
  contact: c,
  delivery,
  onChange,
}: {
  contact: SosContactDTO;
  delivery: Delivery;
  onChange: () => void;
}) {
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testFailed, setTestFailed] = useState(false);
  const via = reachVia(c, delivery);
  const known = typeof delivery !== "string";

  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { results } = await api.testContact(c.id);
      const label = (ch: string) => (ch === "sms" ? "Text" : "Email");
      setTestFailed(results.every((r) => !r.ok));
      setTestResult(results.map((r) => `${label(r.channel)}: ${r.detail}`).join(" · "));
    } catch (err) {
      setTestFailed(true);
      setTestResult(err instanceof ApiError ? err.message : "Couldn't send the test.");
    } finally {
      setTesting(false);
    }
  };

  return (
    <li className="contact-row">
      <span>
        <strong>{c.name}</strong>
        {c.isPrimary && <span className="pill pill-primary">Primary</span>}
        {known && via.length === 0 && (
          <span className="pill pill-warn">Can't be alerted yet</span>
        )}
        <span className="muted"> {[c.phone, c.email].filter(Boolean).join(" · ")}</span>
        {via.length > 0 && <span className="contact-via"> Alerted by {via.join(" and ")}</span>}
        {testResult && (
          <span className={testFailed ? "error contact-test" : "hint contact-test"} role="status">
            {testResult}
          </span>
        )}
      </span>
      <span className="contact-actions">
        <button
          className="btn btn-ghost btn-sm"
          onClick={sendTest}
          disabled={testing || (known && via.length === 0)}
          type="button"
        >
          {testing ? "Sending…" : "Send test alert"}
        </button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            await api.deleteContact(c.id);
            onChange();
          }}
          type="button"
        >
          Remove
        </button>
      </span>
    </li>
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
          Add an emergency contact with a phone number or email above before
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
