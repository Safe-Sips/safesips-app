import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody, parseQuery } from "../http.js";
import { requireAuth, requireVerified } from "../auth/middleware.js";
import { defaultCursor } from "../repos/activity.js";
import { getPrimaryContact } from "../repos/sosContacts.js";
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
});

checkinsRouter.post(
  "/plans",
  requireVerified,
  asyncHandler(async (req, res) => {
    const body = parseBody(planSchema, req, res);
    if (!body) return;

    // A check-in plan is useless without someone to alert. Require a primary
    // SOS contact before the plan can arm.
    if (!getPrimaryContact(req.auth!.userId)) {
      res.status(400).json({
        error: "Add a primary SOS contact before starting check-ins.",
        code: "no_sos_contact",
      });
      return;
    }
    if (body.graceMinutes >= body.intervalMinutes) {
      res.status(400).json({
        error: "Grace window must be shorter than the check-in interval.",
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
    });
    res.status(201).json(plan);
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
