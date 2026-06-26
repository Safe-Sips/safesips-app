import { Router } from "express";
import { z } from "zod";
import { asyncHandler, parseBody, parseQuery } from "../http.js";
import { requireAuth, requireVerified } from "../auth/middleware.js";
import { cleanText } from "../util.js";
import { logActivity } from "../repos/activity.js";
import * as reports from "../repos/reports.js";
import { broadcastReportNew, broadcastReportRemoved } from "../realtime.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);

const NOTE_MAX = 500;
const LABEL_MAX = 200;
const CATEGORY_MAX = 40;
const LIST_LIMIT = 300;

const bboxQuery = z.object({ bbox: z.string().max(120).optional() });

const WORLD: reports.Bbox = { minLat: -90, maxLat: 90, minLng: -180, maxLng: 180 };

function parseBbox(raw: string | undefined): reports.Bbox {
  if (!raw) return WORLD;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return WORLD;
  const [a, b, c, d] = parts; // minLng,minLat,maxLng,maxLat
  return {
    minLng: Math.min(a, c),
    maxLng: Math.max(a, c),
    minLat: Math.min(b, d),
    maxLat: Math.max(b, d),
  };
}

reportsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const q = parseQuery(bboxQuery, req, res);
    if (!q) return;
    res.json(reports.listReportsInBbox(req.auth!.userId, parseBbox(q.bbox), LIST_LIMIT));
  })
);

const createSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  safety: z.enum(["safe", "unsafe"]),
  category: z.string().max(CATEGORY_MAX).nullish(),
  note: z.string().max(NOTE_MAX).nullish(),
  placeLabel: z.string().max(LABEL_MAX).nullish(),
});

reportsRouter.post(
  "/",
  requireVerified,
  asyncHandler(async (req, res) => {
    const body = parseBody(createSchema, req, res);
    if (!body) return;
    const dto = reports.createReport(req.auth!.userId, {
      lat: body.lat,
      lng: body.lng,
      safety: body.safety,
      category: cleanText(body.category, CATEGORY_MAX),
      note: cleanText(body.note, NOTE_MAX),
      placeLabel: cleanText(body.placeLabel, LABEL_MAX),
    });
    logActivity(req.auth!.userId, "report_created", dto.id, dto.placeLabel);
    broadcastReportNew(dto);
    res.status(201).json(dto);
  })
);

reportsRouter.post(
  "/:id/vote",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const author = reports.getReportAuthor(id);
    if (!author) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    if (author === req.auth!.userId) {
      res.status(400).json({ error: "You can't upvote your own report.", code: "self_vote" });
      return;
    }
    if (reports.addReportVote(id, req.auth!.userId)) {
      logActivity(req.auth!.userId, "report_upvoted", id, null);
    }
    res.json({ voteCount: reports.reportVoteCount(id), viewerHasVoted: true });
  })
);

reportsRouter.delete(
  "/:id/vote",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    reports.removeReportVote(id, req.auth!.userId);
    res.json({ voteCount: reports.reportVoteCount(id), viewerHasVoted: false });
  })
);

reportsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const author = reports.getReportAuthor(id);
    if (!author) {
      res.status(404).json({ error: "Report not found." });
      return;
    }
    if (author !== req.auth!.userId) {
      res.status(403).json({ error: "You can only delete your own reports." });
      return;
    }
    reports.deleteReport(id, req.auth!.userId);
    broadcastReportRemoved(id);
    res.json({ ok: true });
  })
);
