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

function clerkClient() {
  if (!config.clerkSecretKey) return null;
  return createClerkClient({ secretKey: config.clerkSecretKey });
}

async function userFromClerkToken(token: string): Promise<UserRow | null> {
  if (!config.clerkSecretKey) return null;
  let sub: string | undefined;
  try {
    const payload = await verifyClerkJwt(token, {
      secretKey: config.clerkSecretKey,
      clockSkewInMs: 10_000,
    });
    sub = payload.sub;
  } catch {
    return null;
  }
  if (!sub) return null;

  const existing = findUserByClerkId(sub);
  if (existing) return existing;

  const client = clerkClient();
  if (!client) return null;
  const clerkUser = await client.users.getUser(sub);
  const primaryEmail =
    clerkUser.emailAddresses.find((e) => e.id === clerkUser.primaryEmailAddressId) ??
    clerkUser.emailAddresses[0];
  if (!primaryEmail?.emailAddress) return null;

  const displayName =
    [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim() ||
    clerkUser.username ||
    primaryEmail.emailAddress.split("@")[0] ||
    "SafeSips user";

  return upsertUserFromClerk({
    clerkId: sub,
    email: primaryEmail.emailAddress,
    displayName,
    emailVerified: primaryEmail.verification?.status === "verified",
  });
}

/** Resolve a local user from a Clerk session JWT or a legacy app JWT. */
export async function resolveAuthFromToken(
  token: string
): Promise<ResolvedAuth | null> {
  const clerkUser = await userFromClerkToken(token);
  if (clerkUser) {
    if (clerkUser.status !== "active") return null;
    return { userId: clerkUser.id, sessionId: "clerk", user: clerkUser };
  }

  const legacy = verifyToken(token);
  if (!legacy) return null;
  const user = findUserById(legacy.userId);
  if (!user || user.status !== "active") return null;
  return { userId: user.id, sessionId: legacy.sessionId, user };
}
