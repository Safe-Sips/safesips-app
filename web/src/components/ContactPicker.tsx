import type { PlanContactDTO } from "@safesips/shared";
import Avatar from "./Avatar";

/**
 * Pick which emergency contacts a check-in alerts. `selected` null means
 * everyone (all ticked, and contacts who accept later are included too).
 */
export default function ContactPicker({
  contacts,
  selected,
  onChange,
}: {
  contacts: Array<PlanContactDTO & { imageUrl?: string | null }>;
  selected: string[] | null;
  onChange: (next: string[] | null) => void;
}) {
  const everyone = selected === null || contacts.every((c) => selected.includes(c.userId));
  const isOn = (id: string) => selected === null || selected.includes(id);

  const toggle = (id: string) => {
    const current = selected ?? contacts.map((c) => c.userId);
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    onChange(next.length === contacts.length ? null : next);
  };

  return (
    <fieldset className="contact-picker">
      <legend>Who to alert if you miss one</legend>
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => onChange(null)}
        disabled={everyone}
      >
        {everyone ? "Everyone selected" : "Select everyone"}
      </button>
      <ul>
        {contacts.map((c) => (
          <li key={c.userId}>
            <label className="contact-picker-row">
              <input type="checkbox" checked={isOn(c.userId)} onChange={() => toggle(c.userId)} />
              <Avatar name={c.displayName} imageUrl={c.imageUrl ?? null} size={28} />
              <span>{c.displayName}</span>
            </label>
          </li>
        ))}
      </ul>
      {selected !== null && selected.length === 0 && (
        <p className="error">Pick at least one contact.</p>
      )}
    </fieldset>
  );
}
