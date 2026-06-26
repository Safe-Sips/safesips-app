import { compareSync, hashSync } from "bcryptjs";
import { config } from "../config.js";

/** Hash a password (or a check-in answer) with bcrypt. */
export function hashSecret(plain: string): string {
  return hashSync(plain, config.bcryptRounds);
}

/** Constant-time-ish bcrypt comparison. */
export function verifySecret(plain: string, hash: string): boolean {
  return compareSync(plain, hash);
}

/**
 * A real-shaped hash compared against when the email is unknown, so a failed
 * login takes a similar amount of time whether or not the account exists
 * (reduces user-enumeration via timing).
 */
export const DUMMY_HASH = hashSync("safesips-dummy-password-x", 10);
