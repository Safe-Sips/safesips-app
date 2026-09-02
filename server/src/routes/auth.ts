import { Router } from "express";
import rateLimit from "express-rate-limit";
import type { AuthResponse } from "@safesips/shared";
import { config } from "../config.js";
import { asyncHandler } from "../http.js";
import { clientIp, requireAuth } from "../auth/middleware.js";
import { hashSecret } from "../auth/passwords.js";
import { issueToken } from "../auth/tokens.js";
import {
  createUser,
  findUserByEmail,
  markEmailVerified,
  toUserDTO,
} from "../repos/users.js";

export const authRouter = Router();

authRouter.use(
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const CLERK_ONLY = {
  error: "Sign in with Clerk. Custom email/password login has been replaced.",
  code: "clerk_only",
} as const;

authRouter.post("/register", (_req, res) => {
  res.status(410).json(CLERK_ONLY);
});
authRouter.post("/login", (_req, res) => {
  res.status(410).json(CLERK_ONLY);
});
authRouter.post("/verify", (_req, res) => {
  res.status(410).json(CLERK_ONLY);
});
authRouter.post("/logout", (_req, res) => {
  res.json({ ok: true });
});
authRouter.post("/resend-verification", (_req, res) => {
  res.status(410).json({
    error: "Verify your email from the Clerk account menu.",
    code: "clerk_only",
  });
});

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: toUserDTO(req.auth!.user) });
  })
);

// Dev/CI only: mint a legacy JWT for smoke tests. Ignored in production.
if (config.allowTestToken) {
  authRouter.get(
    "/test-token",
    asyncHandler(async (req, res) => {
      const email = "smoke@safesips.local";
      let user = findUserByEmail(email);
      if (!user) {
        user = createUser({
          email,
          displayName: "Smoke Test",
          passwordHash: hashSecret("smoke-test-password"),
        });
        markEmailVerified(user.id);
        user = findUserByEmail(email)!;
      }
      const token = issueToken(user.id, user.email_verified === 1, {
        ip: clientIp(req),
        userAgent: "smoke-test",
      });
      const response: AuthResponse = { token, user: toUserDTO(user) };
      res.json(response);
    })
  );
}
