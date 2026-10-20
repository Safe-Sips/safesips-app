import { createHash, createHmac } from "node:crypto";
import { config } from "./config.js";

/**
 * Key for hashing low-entropy identifiers. Derived from HASH_PEPPER when set,
 * otherwise from JWT_SECRET (required in production), with a domain prefix so
 * the derived key is never the JWT signing secret itself.
 */
const identifierKey = createHash("sha256")
  .update(`safesips:identifier-hash:v1:${config.hashPepper ?? config.jwtSecret}`)
  .digest();

/**
 * Keyed hash (HMAC-SHA256) for identifiers we must not store in the clear and
 * that a plain hash would not protect: IP addresses and emails. An unsalted
 * SHA-256 of an IPv4 address can be reversed by brute force in seconds;
 * without the server-held key these hashes can't be reversed or correlated.
 *
 * Not for high-entropy random tokens — plain sha256 is fine there.
 */
export function hashIdentifier(value: string): string {
  return createHmac("sha256", identifierKey).update(value).digest("hex");
}
