import { config } from "../config.js";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Verify a Cloudflare Turnstile token server-side.
 *
 * Pluggable anti-bot: when `TURNSTILE_SECRET` is not configured, captcha is
 * skipped entirely and we rely on the built-in throttle + email verification.
 * A client-claimed "passed" flag is never trusted — verification is always
 * server-side here.
 */
export async function verifyCaptcha(
  token: string | undefined,
  ip?: string
): Promise<boolean> {
  if (!config.turnstileSecret) return true; // not enforced
  if (!token) return false;

  try {
    const body = new URLSearchParams();
    body.set("secret", config.turnstileSecret);
    body.set("response", token);
    if (ip) body.set("remoteip", ip);

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
