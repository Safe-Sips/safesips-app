import type { NextFunction, Request, Response } from "express";
import type { UserRow } from "../repos/users.js";
import { resolveAuthFromToken } from "./clerk.js";

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

/** Best-effort client IP (Express honors trust proxy in production). */
export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "0.0.0.0";
}

/** Reject the request unless it carries a valid Clerk or legacy token. */
export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const token = bearer(req);
  if (!token) {
    res.status(401).json({ error: "Authentication required.", code: "no_token" });
    return;
  }
  void resolveAuthFromToken(token)
    .then((resolved) => {
      if (!resolved) {
        res
          .status(401)
          .json({ error: "Invalid or expired session.", code: "bad_token" });
        return;
      }
      req.auth = resolved;
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
    res.status(401).json({ error: "Authentication required.", code: "no_token" });
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
