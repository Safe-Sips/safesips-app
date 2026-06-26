import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import type { AuthResponse } from "@safesips/shared";
import { config } from "../config.js";
import { asyncHandler, isValidEmail, parseBody } from "../http.js";
import { clientIp, requireAuth } from "../auth/middleware.js";
import { DUMMY_HASH, hashSecret, verifySecret } from "../auth/passwords.js";
import { issueToken, revokeSession } from "../auth/tokens.js";
import {
  buildVerifyUrl,
  consumeVerificationToken,
  createVerificationToken,
  sendVerificationEmail,
} from "../auth/email.js";
import { verifyCaptcha } from "../auth/captcha.js";
import {
  ipKey,
  isThrottled,
  loginKey,
  recordFailure,
} from "../auth/throttle.js";
import {
  createUser,
  findUserByEmail,
  markEmailVerified,
  toUserDTO,
  type UserRow,
} from "../repos/users.js";
import { normalizeEmail } from "../util.js";

export const authRouter = Router();

// Coarse limiter across all auth endpoints (the sliding-window throttle in
// `auth_attempts` handles per-credential lockout more precisely).
authRouter.use(
  rateLimit({
    windowMs: 15 * 60_000,
    limit: 100,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const registerSchema = z.object({
  email: z.string().min(3).max(254).refine(isValidEmail, "Enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters.").max(200),
  displayName: z
    .string()
    .trim()
    .min(2, "Display name must be at least 2 characters.")
    .max(40),
  captchaToken: z.string().max(5000).optional(),
});

const loginSchema = z.object({
  email: z.string().min(3).max(254),
  password: z.string().min(1).max(200),
});

const verifySchema = z.object({
  token: z.string().min(8).max(256),
});

function authResponse(user: UserRow, ip: string, userAgent?: string): AuthResponse {
  const token = issueToken(user.id, user.email_verified === 1, { ip, userAgent });
  return { token, user: toUserDTO(user) };
}

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const body = parseBody(registerSchema, req, res);
    if (!body) return;

    const ip = clientIp(req);
    const captchaOk = await verifyCaptcha(body.captchaToken, ip);
    if (!captchaOk) {
      res.status(400).json({ error: "Captcha verification failed.", code: "captcha" });
      return;
    }

    if (findUserByEmail(body.email)) {
      res.status(409).json({ error: "An account with this email already exists.", code: "email_taken" });
      return;
    }

    const user = createUser({
      email: body.email,
      displayName: body.displayName,
      passwordHash: hashSecret(body.password),
    });

    const rawToken = createVerificationToken(user.id);
    void sendVerificationEmail(user.email, rawToken);

    const response = authResponse(user, ip, req.headers["user-agent"]);
    // Dev convenience: surface the verify link so testing needs no mailbox.
    if (!config.isProduction) {
      (response as AuthResponse).verifyUrl = buildVerifyUrl(rawToken);
    }
    res.status(201).json(response);
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const body = parseBody(loginSchema, req, res);
    if (!body) return;

    const ip = clientIp(req);
    const emailNorm = normalizeEmail(body.email);
    if (isThrottled(loginKey(emailNorm)) || isThrottled(ipKey(ip))) {
      res.status(429).json({
        error: "Too many attempts. Please wait a few minutes and try again.",
        code: "throttled",
      });
      return;
    }

    const user = findUserByEmail(body.email);
    if (!user) {
      // Compare against a dummy hash to keep timing similar for unknown emails.
      verifySecret(body.password, DUMMY_HASH);
      recordFailure(loginKey(emailNorm));
      recordFailure(ipKey(ip));
      res.status(401).json({ error: "Invalid email or password.", code: "bad_credentials" });
      return;
    }
    if (user.status !== "active") {
      res.status(403).json({ error: "This account is not available.", code: "inactive" });
      return;
    }
    if (!verifySecret(body.password, user.password_hash)) {
      recordFailure(loginKey(emailNorm));
      recordFailure(ipKey(ip));
      res.status(401).json({ error: "Invalid email or password.", code: "bad_credentials" });
      return;
    }

    res.json(authResponse(user, ip, req.headers["user-agent"]));
  })
);

authRouter.post(
  "/verify",
  asyncHandler(async (req, res) => {
    const body = parseBody(verifySchema, req, res);
    if (!body) return;
    const result = consumeVerificationToken(body.token);
    if (!result.ok || !result.userId) {
      res.status(400).json({
        error:
          result.reason === "expired"
            ? "This verification link has expired."
            : result.reason === "used"
              ? "This verification link was already used."
              : "Invalid verification link.",
        code: result.reason ?? "invalid",
      });
      return;
    }
    markEmailVerified(result.userId);
    res.json({ ok: true });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: toUserDTO(req.auth!.user) });
  })
);

authRouter.post(
  "/logout",
  requireAuth,
  asyncHandler(async (req, res) => {
    revokeSession(req.auth!.sessionId);
    res.json({ ok: true });
  })
);

authRouter.post(
  "/resend-verification",
  requireAuth,
  rateLimit({ windowMs: 10 * 60_000, limit: 5, standardHeaders: true, legacyHeaders: false }),
  asyncHandler(async (req, res) => {
    const user = req.auth!.user;
    if (user.email_verified === 1) {
      res.json({ ok: true });
      return;
    }
    const rawToken = createVerificationToken(user.id);
    void sendVerificationEmail(user.email, rawToken);
    const payload: { ok: true; verifyUrl?: string } = { ok: true };
    if (!config.isProduction) payload.verifyUrl = buildVerifyUrl(rawToken);
    res.json(payload);
  })
);

// Dev/CI only: mint a token for a throwaway verified user so the smoke test can
// authenticate the socket handshake. Never enabled in production.
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
      res.json(authResponse(user, clientIp(req), "smoke-test"));
    })
  );
}
