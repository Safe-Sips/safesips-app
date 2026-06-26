import { createHash, randomBytes, randomUUID } from "node:crypto";

/** A fresh, non-identifying UUID for primary keys. */
export function genId(): string {
  return randomUUID();
}

/** Epoch-ms timestamp (matches the existing PresenceRecord time fields). */
export function nowMs(): number {
  return Date.now();
}

/** Hex SHA-256 — used to store only hashes of secrets (tokens) and IPs. */
export function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/** A high-entropy opaque token (raw value; store only its sha256). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

/** Canonical form used for uniqueness + lookups. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalize a check-in answer before hashing/comparing (case/space-insensitive). */
export function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Clamp/trim free text to a maximum length, returning null for empties. */
export function cleanText(
  value: unknown,
  maxLen: number
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}
