import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler, isValidEmail, parseBody } from "../http.js";
import { verifyCaptcha } from "../auth/captcha.js";
import { clientIp } from "../auth/middleware.js";
import { db } from "../db.js";
import { cleanText, genId, normalizeEmail, nowMs, sha256 } from "../util.js";

export const waitlistRouter = Router();

// Public endpoint — throttle hard per IP and dedupe on email.
waitlistRouter.use(
  rateLimit({
    windowMs: 60 * 60_000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

const insertWaitlist = db.prepare(
  `INSERT OR IGNORE INTO waitlist
     (id, name, email, email_norm, country, interest, created_at, ip_hash)
   VALUES (@id, @name, @email, @email_norm, @country, @interest, @created_at, @ip_hash)`
);

const schema = z.object({
  name: z.string().trim().min(2, "Tell us your name.").max(80),
  email: z.string().min(3).max(254).refine(isValidEmail, "Enter a valid email."),
  country: z.string().trim().max(80).optional().nullable(),
  interest: z.string().trim().max(40).optional().nullable(),
  captchaToken: z.string().max(5000).optional(),
});

waitlistRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parseBody(schema, req, res);
    if (!body) return;
    const ip = clientIp(req);
    if (!(await verifyCaptcha(body.captchaToken, ip))) {
      res.status(400).json({ error: "Captcha verification failed.", code: "captcha" });
      return;
    }
    insertWaitlist.run({
      id: genId(),
      name: body.name.trim(),
      email: body.email.trim(),
      email_norm: normalizeEmail(body.email),
      country: cleanText(body.country, 80),
      interest: cleanText(body.interest, 40),
      created_at: nowMs(),
      ip_hash: sha256(ip),
    });
    // Always report success — never reveal whether the email already existed.
    res.status(201).json({ ok: true });
  })
);
