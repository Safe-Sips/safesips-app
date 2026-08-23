import { createClerkClient, verifyToken as verifyClerkJwt } from "@clerk/backend";
import { config } from "../config.js";
import {
  findUserByClerkId,
  findUserById,
  upsertUserFromClerk,
  type UserRow,
} from "../repos/users.js";
import { verifyToken } from "./tokens.js";

export interface ResolvedAuth {
  userId: string;
  sessionId: string;
  user: UserRow;
}

export type AuthResolveFailure =
  | { ok: false; code: "clerk_not_configured" }
  | { ok: false; code: "clerk_verify_failed"; detail?: string }
  | { ok: false; code: "clerk_user_unavailable" }
  | { ok: false; code: "bad_token" };

export type AuthResolveResult =
  | ({ ok: true } & ResolvedAuth)
  | AuthResolveFailure;

function clerkClient() {
  if (!config.clerkSecretKey) return null;
  return createClerkClient({ secretKey: config.clerkSecretKey });
}

function authorizedParties(): string[] | undefined {
  // Only enforce azp when explicitly configured — a wrong allowlist rejects
  // valid Netlify/custom-domain sessions.
  const raw = process.env.CLERK_AUTHORIZED_PARTIES?.trim();
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

async function userFromClerkToken(
  token: string
): Promise<{ user: UserRow } | AuthResolveFailure> {
  if (!config.clerkSecretKey) {
    return { ok: false, code: "clerk_not_configured" };
  }

  let sub: string | undefined;
  try {
    const payload = await verifyClerkJwt(token, {
      secretKey: config.clerkSecretKey,
      clockSkewInMs: 10_000,
      authorizedParties: authorizedParties(),
    });
    sub = payload.sub;
  } catch (err) {
    const detail = err instanceof Error ? err.message : "verify_failed";
    // eslint-disable-next-line no-console
    console.warn("[clerk] session token verification failed:", detail);
    return { ok: false, code: "clerk_verify_failed", detail };
  }
  if (!sub) return { ok: false, code: "clerk_verify_failed", detail: "missing_sub" };

  const existing = findUserByClerkId(sub);
  if (existing) return { user: existing };

  const client = clerkClient();
  if (!client) return { ok: false, code: "clerk_not_configured" };

  try {
    const clerkUser = await client.users.getUser(sub);
    const primaryEmail =
      clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId) ??
      clerkUser.emailAddresses[0];
    if (!primaryEmail?.emailAddress) {
      return { ok: false, code: "clerk_user_unavailable" };
    }

    const displayName =
      [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
      clerkUser.username ||
      primaryEmail.emailAddress.split("@")[0] ||
      "SafeSips user";

    return {
      user: upsertUserFromClerk({
        clerkId: sub,
        email: primaryEmail.emailAddress,
        displayName,
        emailVerified: primaryEmail.verification?.status === "verified",
      }),
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : "user_fetch_failed";
    // eslint-disable-next-line no-console
    console.warn("[clerk] failed to load Clerk user:", detail);
    return { ok: false, code: "clerk_user_unavailable" };
  }
}

/** Resolve a local user from a Clerk session JWT or a legacy app JWT. */
export async function resolveAuthFromToken(
  token: string
): Promise<AuthResolveResult> {
  const clerkResult = await userFromClerkToken(token);
  if ("user" in clerkResult) {
    if (clerkResult.user.status !== "active") {
      return { ok: false, code: "bad_token" };
    }
    return {
      ok: true,
      userId: clerkResult.user.id,
      sessionId: "clerk",
      user: clerkResult.user,
    };
  }
  // Only fall through to legacy JWT when Clerk isn't configured or the token
  // clearly isn't a Clerk session (verify failed). Prefer Clerk error codes.
  if (clerkResult.code === "clerk_not_configured") {
    const legacy = verifyToken(token);
    if (!legacy) return clerkResult;
    const user = findUserById(legacy.userId);
    if (!user || user.status !== "active") return { ok: false, code: "bad_token" };
    return {
      ok: true,
      userId: user.id,
      sessionId: legacy.sessionId,
      user,
    };
  }

  return clerkResult;
}
