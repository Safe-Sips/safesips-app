import { Router } from "express";
import { z } from "zod";
import { normalizePhone, type SosDeliveryDTO } from "@safesips/shared";
import { isEmailDeliveryConfigured } from "../mailer.js";
import { isSmsConfigured } from "../sms.js";
import { sendTestAlert } from "../notify.js";
import { asyncHandler, isValidEmail, parseBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { cleanText } from "../util.js";
import { findUserById } from "../repos/users.js";
import {
  createContact,
  deleteContact,
  getContact,
  listContacts,
} from "../repos/sosContacts.js";

export const sosContactsRouter = Router();
sosContactsRouter.use(requireAuth);

const NAME_MAX = 80;
const PHONE_MAX = 40;

const contactSchema = z
  .object({
    name: z.string().trim().min(2, "Name is too short.").max(NAME_MAX),
    email: z.string().max(254).optional().nullable(),
    phone: z.string().max(PHONE_MAX).optional().nullable(),
    isPrimary: z.boolean().optional(),
  })
  .refine(
    (v) => !!(v.email?.trim() || v.phone?.trim()),
    "Add a phone number or an email so we can alert them."
  )
  .refine(
    (v) => !v.email?.trim() || isValidEmail(v.email.trim()),
    "Enter a valid email."
  )
  .refine(
    (v) => !v.phone?.trim() || normalizePhone(v.phone) !== null,
    "Enter a valid phone number, e.g. 0722 123 456 or +40 722 123 456."
  );

sosContactsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(listContacts(req.auth!.userId));
  })
);

/** Which alert channels actually work on this server (see SosDeliveryDTO). */
sosContactsRouter.get(
  "/delivery",
  asyncHandler(async (_req, res) => {
    const dto: SosDeliveryDTO = { email: isEmailDeliveryConfigured(), sms: isSmsConfigured() };
    res.json(dto);
  })
);

sosContactsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const body = parseBody(contactSchema, req, res);
    if (!body) return;
    const dto = createContact(req.auth!.userId, {
      name: body.name.trim(),
      email: cleanText(body.email, 254),
      // Stored in international (E.164) form, which SMS gateways require.
      phone: body.phone?.trim() ? normalizePhone(body.phone) : null,
      isPrimary: body.isPrimary === true,
    });
    res.status(201).json(dto);
  })
);

// Test alerts cost money and land on someone else's phone: at most a few per
// user per day (SMS has its own per-number and global caps on top of this).
const TEST_REQUESTS_PER_DAY = 5;
const testRequests = new Map<string, number[]>();
function allowTestRequest(userId: string): boolean {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = (testRequests.get(userId) ?? []).filter((t) => t > since);
  if (recent.length >= TEST_REQUESTS_PER_DAY) {
    testRequests.set(userId, recent);
    return false;
  }
  recent.push(Date.now());
  testRequests.set(userId, recent);
  return true;
}

/** Send a test alert to one contact, so the user can check it really arrives. */
sosContactsRouter.post(
  "/:id/test",
  asyncHandler(async (req, res) => {
    const userId = req.auth!.userId;
    const contact = getContact(userId, req.params.id);
    if (!contact) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }
    if (!allowTestRequest(userId)) {
      res.status(429).json({
        error: "You've sent the maximum test alerts for today. Try again tomorrow.",
        code: "test_limited",
      });
      return;
    }
    const name = findUserById(userId)?.display_name ?? "A SafeSips user";
    res.json({ results: await sendTestAlert(userId, name, contact) });
  })
);

sosContactsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const removed = deleteContact(req.auth!.userId, req.params.id);
    if (!removed) {
      res.status(404).json({ error: "Contact not found." });
      return;
    }
    res.json({ ok: true });
  })
);
