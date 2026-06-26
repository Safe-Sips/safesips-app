import { Router } from "express";
import { z } from "zod";
import { asyncHandler, isValidEmail, parseBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { cleanText } from "../util.js";
import {
  createContact,
  deleteContact,
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
    (v) => (v.email && v.email.trim()) || (v.phone && v.phone.trim()),
    "Add an email or phone number so we can reach them."
  )
  .refine(
    (v) => !v.email || !v.email.trim() || isValidEmail(v.email.trim()),
    "Enter a valid email."
  );

sosContactsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    res.json(listContacts(req.auth!.userId));
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
      phone: cleanText(body.phone, PHONE_MAX),
      isPrimary: body.isPrimary === true,
    });
    res.status(201).json(dto);
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
