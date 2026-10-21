import type { NextFunction, Request, Response } from "express";
import type { UserRow } from "../repos/users.js";
import { resolveAuthFromToken } from "./clerk.js";
import { ensureConnectionsRestored } from "../connectionBackup.js";
import { clientIpFrom } from "../clientIp.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by requireAuth once a valid token + active user is resolved. */
      auth?: { userId: string; sessionId: string; user: UserRow };
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  return token || null;
}

/** Best-effort client IP behind the hosting proxy (see clientIp.ts). */
export function clientIp(req: Request): string {
  return clientIpFrom(req.headers, req.socket.remoteAddress);
}

const AUTH_ERROR_MESSAGE: Record<string, string> = {
  no_token: "Authentication required.",
  clerk_not_configured:
    "Server is missing CLERK_SECRET_KEY. Set it on Render and redeploy.",
  clerk_verify_failed:
    "Clerk session could not be verified. Check that the web app's publishable key and the API's secret key are from the same Clerk app.",
  clerk_user_unavailable: "Could not load your Clerk user profile.",
  bad_token: "Invalid or expired session.",
  account_suspended:
    "Your SafeSips account is suspended for breaking the community rules. If you think this is a mistake, email safesipss@gmail.com.",
};

/** Reject the request unless it carries a valid Clerk or legacy token. */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: AUTH_ERROR_MESSAGE.no_token, code: "no_token" });
    return;
  }
  void resolveAuthFromToken(token)
    .then(async (resolved) => {
      if (!resolved.ok) {
        // Suspended is a decision, not a broken session: 403 so the app shows why.
        res.status(resolved.code === "account_suspended" ? 403 : 401).json({
          error: AUTH_ERROR_MESSAGE[resolved.code] ?? AUTH_ERROR_MESSAGE.bad_token,
          code: resolved.code,
        });
        return;
      }
      // First visit since the database was wiped: bring back saved friends
      // and emergency contacts.
      if (!resolved.user.friends_restored) await ensureConnectionsRestored(resolved.user);
      req.auth = {
        userId: resolved.userId,
        sessionId: resolved.sessionId,
        user: resolved.user,
      };
      next();
    })
    .catch(next);
}

/** Must run after requireAuth. Blocks unverified accounts from creating content. */
export function requireVerified(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!req.auth) {
    res.status(401).json({ error: AUTH_ERROR_MESSAGE.no_token, code: "no_token" });
    return;
  }
  if (req.auth.user.email_verified !== 1) {
    res.status(403).json({
      error: "Please verify your email before posting or reporting.",
      code: "email_unverified",
    });
    return;
  }
  next();
}
