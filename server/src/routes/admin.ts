import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { ModerationItemDTO } from "@safesips/shared";
import { asyncHandler, parseBody } from "../http.js";
import { requireAuth } from "../auth/middleware.js";
import { config } from "../config.js";
import { db } from "../db.js";
import { broadcastReportNew, broadcastReportRemoved, purgeUserRealtime } from "../realtime.js";
import * as forum from "../repos/forum.js";
import * as reports from "../repos/reports.js";

/**
 * Moderation queue for the people listed in ADMIN_EMAILS: everything someone
 * reported, with actions to hide/restore it, dismiss the reports, or suspend
 * the author. (Content is also hidden automatically once enough people
 * report it; see repos/moderation.ts.)
 */
export const adminRouter = Router();
adminRouter.use(requireAuth);

export function isAdminEmail(emailNorm: string): boolean {
  return config.adminEmails.includes(emailNorm);
}

function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!isAdminEmail(req.auth!.user.email_norm)) {
    res.status(404).json({ error: "Not found." });
    return;
  }
  next();
}
adminRouter.use(requireAdmin);

const flaggedPosts = db.prepare(
  `SELECT 'post' AS type, p.id, p.body AS text, t.title AS context, p.author_id, u.display_name AS author_name,
          u.status AS author_status, p.status AS post_status, t.status AS thread_status, p.created_at,
          (SELECT op0.id FROM forum_posts op0 WHERE op0.thread_id = p.thread_id
            ORDER BY op0.created_at ASC, op0.rowid ASC LIMIT 1) = p.id AS is_opener,
          COUNT(f.reporter_id) AS flags, MAX(f.created_at) AS last_flag_at,
          GROUP_CONCAT(f.reason, ' | ') AS reasons
     FROM content_flags f
     JOIN forum_posts p ON p.id = f.target_id
     JOIN forum_threads t ON t.id = p.thread_id
     JOIN users u ON u.id = p.author_id
    WHERE f.target_type = 'post'
    GROUP BY p.id`
);
const flaggedReports = db.prepare(
  `SELECT 'report' AS type, r.id, r.note AS text,
          r.safety || COALESCE(' · ' || r.category, '') AS context, r.author_id, u.display_name AS author_name,
          u.status AS author_status, r.status AS post_status, NULL AS thread_status, r.created_at, 0 AS is_opener,
          COUNT(f.reporter_id) AS flags, MAX(f.created_at) AS last_flag_at,
          GROUP_CONCAT(f.reason, ' | ') AS reasons
     FROM content_flags f
     JOIN reports r ON r.id = f.target_id
     JOIN users u ON u.id = r.author_id
    WHERE f.target_type = 'report'
    GROUP BY r.id`
);

interface FlaggedRow {
  type: "post" | "report";
  id: string;
  text: string | null;
  context: string | null;
  author_id: string;
  author_name: string;
  author_status: string;
  post_status: string;
  thread_status: string | null;
  created_at: number;
  is_opener: number;
  flags: number;
  last_flag_at: number;
  reasons: string | null;
}

function toItem(r: FlaggedRow): ModerationItemDTO {
  // An opening post's visibility is its discussion's.
  const status = r.type === "post" && r.is_opener ? r.thread_status ?? r.post_status : r.post_status;
  return {
    type: r.type,
    id: r.id,
    text: r.text ?? "",
    context: r.context ?? "",
    authorId: r.author_id,
    authorName: r.author_name,
    authorSuspended: r.author_status !== "active",
    hidden: status !== "visible",
    deleted: status === "deleted" || r.thread_status === "deleted",
    flags: r.flags,
    reasons: (r.reasons ?? "").split(" | ").filter(Boolean),
    createdAt: r.created_at,
    lastFlagAt: r.last_flag_at,
  };
}

adminRouter.get(
  "/queue",
  asyncHandler(async (_req, res) => {
    const items = [...(flaggedPosts.all() as FlaggedRow[]), ...(flaggedReports.all() as FlaggedRow[])]
      .map(toItem)
      .sort((a, b) => Number(a.hidden) - Number(b.hidden) || b.lastFlagAt - a.lastFlagAt);
    res.json({ items });
  })
);

const clearFlags = db.prepare(`DELETE FROM content_flags WHERE target_type = ? AND target_id = ?`);
const setUserStatus = db.prepare(`UPDATE users SET status = ?, updated_at = ? WHERE id = ?`);

const actionSchema = z.object({
  type: z.enum(["post", "report"]),
  id: z.string().min(1).max(64),
  action: z.enum(["hide", "restore", "dismiss"]),
});

/** hide / restore a post or report, or dismiss its reports (leaves it as is). */
adminRouter.post(
  "/content",
  asyncHandler(async (req, res) => {
    const body = parseBody(actionSchema, req, res);
    if (!body) return;
    if (body.action !== "dismiss") {
      if (body.type === "post") {
        const result = forum.moderatePost(body.id, body.action);
        if (result === "deleted") {
          res.status(409).json({ error: "Its author deleted this, so it can't be restored.", code: "deleted" });
          return;
        }
        if (result === "missing") {
          res.status(404).json({ error: "Not found." });
          return;
        }
      } else if (body.action === "hide") {
        reports.hideReport(body.id);
        broadcastReportRemoved(body.id);
      } else if (reports.restoreReport(body.id)) {
        const dto = reports.getReportDTO(body.id, req.auth!.userId);
        if (dto) broadcastReportNew(dto);
      }
    }
    // Restoring or dismissing settles the reports.
    if (body.action !== "hide") clearFlags.run(body.type, body.id);
    res.json({ ok: true });
  })
);

const userSchema = z.object({ suspended: z.boolean() });

/** Suspend (or reinstate) an account. Suspended accounts can't sign in to the API. */
adminRouter.post(
  "/users/:id/status",
  asyncHandler(async (req, res) => {
    const body = parseBody(userSchema, req, res);
    if (!body) return;
    if (req.params.id === req.auth!.userId) {
      res.status(400).json({ error: "You can't suspend yourself." });
      return;
    }
    const changed = setUserStatus.run(body.suspended ? "suspended" : "active", Date.now(), req.params.id).changes;
    if (!changed) {
      res.status(404).json({ error: "User not found." });
      return;
    }
    // Their posts, discussions and map reports go down with them (and come
    // back if they're reinstated).
    forum.setAuthorSuspended(req.params.id, body.suspended);
    for (const id of reports.setAuthorReportsSuspended(req.params.id, body.suspended)) {
      if (body.suspended) broadcastReportRemoved(id);
      else {
        const dto = reports.getReportDTO(id, req.auth!.userId);
        if (dto) broadcastReportNew(dto);
      }
    }
    if (body.suspended) purgeUserRealtime(req.params.id);
    res.json({ ok: true });
  })
);
