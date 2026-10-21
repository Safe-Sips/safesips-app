import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody, parseQuery } from "../http.js";
import { requireAuth, requireVerified } from "../auth/middleware.js";
import { defaultCursor } from "../repos/activity.js";
import { hasAcceptedContact, listAcceptedContacts } from "../repos/emergencyContacts.js";
import * as checkins from "../repos/checkins.js";

export const checkinsRouter = Router();
checkinsRouter.use(requireAuth);

const OCC_LIMIT = 40;

checkinsRouter.get(
  "/plans",
  asyncHandler(async (req, res) => {
    res.json(checkins.listPlans(req.auth!.userId));
  })
);

const planSchema = z.object({
  label: z.string().trim().max(80).optional().nullable(),
  intervalMinutes: z.number().int().min(1).max(1440),
  graceMinutes: z.number().int().min(1).max(180),
  question: z.string().trim().min(3, "Question is too short.").max(200),
  answer: z.string().trim().min(1, "Answer can't be empty.").max(100),
  endsAt: z.number().int().positive().optional().nullable(),
  /** Who to alert; omitted/null = all accepted contacts. */
  contactUserIds: z.array(z.string().min(1).max(64)).max(50).optional().nullable(),
});

/**
 * Validate a selection of contacts: every id must be one of my accepted
 * contacts. Returns the de-duplicated ids (null = everyone), or an error.
 */
function checkContactSelection(
  userId: string,
  ids: string[] | null | undefined
): { ids: string[] | null } | { error: string } {
  if (ids == null) return { ids: null };
  const unique = [...new Set(ids)];
  if (unique.length === 0) return { error: "Pick at least one emergency contact to alert." };
  const accepted = new Set(listAcceptedContacts(userId).map((c) => c.id));
  if (unique.some((id) => !accepted.has(id))) {
    return { error: "You can only pick emergency contacts who have accepted." };
  }
  // Everyone selected = "everyone", so contacts who accept later are included too.
  return { ids: unique.length === accepted.size ? null : unique };
}

checkinsRouter.post(
  "/plans",
  requireVerified,
  asyncHandler(async (req, res) => {
    const body = parseBody(planSchema, req, res);
    if (!body) return;

    // A check-in plan is useless without someone to alert: require at least
    // one emergency contact who has accepted.
    if (!hasAcceptedContact(req.auth!.userId)) {
      res.status(400).json({
        error: "Add an emergency contact (and wait for them to accept) before starting check-ins.",
        code: "no_sos_contact",
      });
      return;
    }
    const selection = checkContactSelection(req.auth!.userId, body.contactUserIds);
    if ("error" in selection) {
      res.status(400).json({ error: selection.error, code: "bad_contacts" });
      return;
    }
    // Equal is fine: each check-in's deadline is when the next one starts, so
    // they never overlap (e.g. a 1-minute test plan with 1 minute to answer).
    if (body.graceMinutes > body.intervalMinutes) {
      res.status(400).json({
        error: "Time to answer can't be longer than the check-in interval.",
        code: "bad_grace",
      });
      return;
    }

    const plan = checkins.createPlan(req.auth!.userId, {
      label: body.label ?? null,
      intervalMinutes: body.intervalMinutes,
      graceMinutes: body.graceMinutes,
      question: body.question,
      answer: body.answer,
      endsAt: body.endsAt ?? null,
      contactUserIds: selection.ids,
    });
    res.status(201).json(plan);
  })
);

const contactsSchema = z.object({
  contactUserIds: z.array(z.string().min(1).max(64)).max(50).nullable(),
});

/** Change who a running check-in alerts. */
checkinsRouter.put(
  "/plans/:id/contacts",
  asyncHandler(async (req, res) => {
    const body = parseBody(contactsSchema, req, res);
    if (!body) return;
    const selection = checkContactSelection(req.auth!.userId, body.contactUserIds);
    if ("error" in selection) {
      res.status(400).json({ error: selection.error, code: "bad_contacts" });
      return;
    }
    const plan = checkins.setPlanContacts(req.auth!.userId, req.params.id, selection.ids);
    if (!plan) {
      res.status(404).json({ error: "Plan not found." });
      return;
    }
    res.json(plan);
  })
);

checkinsRouter.post(
  "/plans/:id/pause",
  asyncHandler(async (req, res) => {
    if (!checkins.pausePlan(req.auth!.userId, req.params.id)) {
      res.status(404).json({ error: "Active plan not found." });
      return;
    }
    res.json({ ok: true });
  })
);

checkinsRouter.post(
  "/plans/:id/resume",
  asyncHandler(async (req, res) => {
    if (!hasAcceptedContact(req.auth!.userId)) {
      res.status(400).json({
        error: "Add an emergency contact (and wait for them to accept) before resuming check-ins.",
        code: "no_sos_contact",
      });
      return;
    }
    const plan = checkins.resumePlan(req.auth!.userId, req.params.id);
    if (!plan) {
      res.status(404).json({ error: "Paused plan not found." });
      return;
    }
    res.json(plan);
  })
);

checkinsRouter.post(
  "/plans/:id/end",
  asyncHandler(async (req, res) => {
    if (!checkins.endPlan(req.auth!.userId, req.params.id)) {
      res.status(404).json({ error: "Plan not found." });
      return;
    }
    res.json({ ok: true });
  })
);

checkinsRouter.get(
  "/active",
  asyncHandler(async (req, res) => {
    res.json({ occurrence: checkins.getActiveOccurrence(req.auth!.userId) });
  })
);

const answerSchema = z.object({
  answer: z.string().min(1).max(100),
});

checkinsRouter.post(
  "/occurrences/:id/answer",
  asyncHandler(async (req, res) => {
    const body = parseBody(answerSchema, req, res);
    if (!body) return;
    const result = checkins.answerOccurrence(
      req.auth!.userId,
      req.params.id,
      body.answer
    );
    if (!result) {
      res.status(404).json({ error: "Check-in not found." });
      return;
    }
    res.json(result);
  })
);

const occQuery = z.object({ cursor: z.coerce.number().optional() });

checkinsRouter.get(
  "/occurrences",
  asyncHandler(async (req, res) => {
    const q = parseQuery(occQuery, req, res);
    if (!q) return;
    const before = q.cursor ?? defaultCursor();
    res.json(checkins.listOccurrences(req.auth!.userId, before, OCC_LIMIT));
  })
);
