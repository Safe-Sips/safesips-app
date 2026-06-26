/**
 * Static spiking / drink-contamination first-aid content.
 *
 * Safety-critical, emergency-forward, general information only — NOT medical
 * advice. This copy should be reviewed by a qualified person before launch.
 */

export const EMERGENCY_NUMBER = "112";

export interface InfoStep {
  title: string;
  body: string;
}

/** Common first effects if a drink has been spiked (e.g. GHB, benzos, ketamine). */
export const FIRST_EFFECTS: string[] = [
  "Feeling far more drunk than your drinks should explain",
  "Sudden dizziness, lightheadedness or feeling faint",
  "Losing strength in your legs — they feel heavy, weak or won't hold you",
  "Trouble moving, standing or controlling your body",
  "Slurred speech and trouble concentrating",
  "Confusion or feeling disoriented",
  "Strong drowsiness — struggling to stay awake",
  "Nausea or vomiting",
  "Blurred or double vision",
  "Gaps in memory you can't explain",
];

/** What to do FIRST if you think you've been spiked. */
export const FIRST_STEPS: InfoStep[] = [
  {
    title: "Tell someone you trust — right now",
    body: "Don't keep it to yourself. Tell a friend, the venue staff or security immediately. The sooner someone knows, the safer you are.",
  },
  {
    title: "Get to a safe, well-lit, public place",
    body: "Move toward people and light. Stay with people you trust. Do not go off on your own and do not leave with someone you don't fully trust.",
  },
  {
    title: "Call 112 if you feel very unwell",
    body: "Call emergency services if you can't stay awake, can't move, have trouble breathing, or are getting worse. Effects can escalate quickly — it's better to call early.",
  },
  {
    title: "Stop drinking and protect your drink",
    body: "Don't drink any more alcohol and don't accept new drinks. Keep your current drink with you, or get a fresh, sealed one.",
  },
  {
    title: "Arrange safe transport with a trusted person",
    body: "Ask staff to help you get home safely with someone you trust. Avoid travelling alone.",
  },
  {
    title: "Note what happened",
    body: "If you can, remember the time, what you drank and where. This helps medical staff and police later.",
  },
];

/** How to help someone else who may have been spiked. */
export const HELP_SOMEONE: InfoStep[] = [
  {
    title: "Stay with them",
    body: "Never leave them alone, even for a minute, and don't let them leave with someone they (or you) don't trust.",
  },
  {
    title: "If they're very drowsy or unconscious, call 112",
    body: "Put them on their side in the recovery position so they don't choke, keep them warm, and keep talking to them while you wait for help.",
  },
  {
    title: "Tell venue security",
    body: "Ask staff to help and to keep any drink so it can be tested. Help them get safe transport with a trusted person.",
  },
];

export const DISCLAIMER =
  "SafeSips is not a medical or emergency service. This is general safety information, not medical advice. If you think you or someone else has been drugged, seek medical help immediately and call 112 (or your local emergency number).";
