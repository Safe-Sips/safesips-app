import type { ReportDTO, ReportInput, ReportSafety } from "@safesips/shared";
import { db } from "../db.js";
import { genId, nowMs } from "../util.js";

interface ReportJoinRow {
  id: string;
  author_id: string;
  lat: number;
  lng: number;
  safety: ReportSafety;
  category: string | null;
  note: string | null;
  place_label: string | null;
  created_at: number;
  author_name: string;
  vote_count: number;
  viewer_voted: number;
}

const SELECT_BASE = `
  SELECT r.id, r.author_id, r.lat, r.lng, r.safety, r.category, r.note,
         r.place_label, r.created_at,
         u.display_name AS author_name,
         (SELECT COUNT(*) FROM report_votes v WHERE v.report_id = r.id) AS vote_count,
         EXISTS(SELECT 1 FROM report_votes v WHERE v.report_id = r.id AND v.user_id = @viewer) AS viewer_voted
  FROM reports r
  JOIN users u ON u.id = r.author_id
`;

const selectInBbox = db.prepare(
  `${SELECT_BASE}
   WHERE r.status = 'visible'
     AND r.lat BETWEEN @minLat AND @maxLat
     AND r.lng BETWEEN @minLng AND @maxLng
   ORDER BY r.created_at DESC
   LIMIT @limit`
);
const selectById = db.prepare(
  `${SELECT_BASE} WHERE r.id = @id AND r.status = 'visible'`
);
const insertReport = db.prepare(
  `INSERT INTO reports
     (id, author_id, lat, lng, safety, category, note, place_label, created_at, updated_at, status)
   VALUES
     (@id, @author_id, @lat, @lng, @safety, @category, @note, @place_label, @created_at, @updated_at, 'visible')`
);
const deleteReportStmt = db.prepare(
  `DELETE FROM reports WHERE id = ? AND author_id = ?`
);
const insertVote = db.prepare(
  `INSERT OR IGNORE INTO report_votes (report_id, user_id, value, created_at)
   VALUES (?, ?, 1, ?)`
);
const deleteVote = db.prepare(
  `DELETE FROM report_votes WHERE report_id = ? AND user_id = ?`
);
const countVotes = db.prepare(
  `SELECT COUNT(*) AS c FROM report_votes WHERE report_id = ?`
);
const reportExists = db.prepare(`SELECT author_id FROM reports WHERE id = ? AND status = 'visible'`);

function rowToDTO(row: ReportJoinRow): ReportDTO {
  return {
    id: row.id,
    lat: row.lat,
    lng: row.lng,
    safety: row.safety,
    category: row.category,
    note: row.note,
    placeLabel: row.place_label,
    authorId: row.author_id,
    authorDisplayName: row.author_name,
    voteCount: row.vote_count,
    viewerHasVoted: row.viewer_voted === 1,
    createdAt: row.created_at,
  };
}

export interface Bbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

export function listReportsInBbox(
  viewerId: string,
  bbox: Bbox,
  limit: number
): ReportDTO[] {
  const rows = selectInBbox.all({ ...bbox, viewer: viewerId, limit }) as ReportJoinRow[];
  return rows.map(rowToDTO);
}

export function getReportDTO(id: string, viewerId: string): ReportDTO | undefined {
  const row = selectById.get({ id, viewer: viewerId }) as ReportJoinRow | undefined;
  return row ? rowToDTO(row) : undefined;
}

export function createReport(
  authorId: string,
  input: ReportInput & { placeLabel: string | null; category: string | null; note: string | null }
): ReportDTO {
  const now = nowMs();
  const id = genId();
  insertReport.run({
    id,
    author_id: authorId,
    lat: input.lat,
    lng: input.lng,
    safety: input.safety,
    category: input.category,
    note: input.note,
    place_label: input.placeLabel,
    created_at: now,
    updated_at: now,
  });
  return getReportDTO(id, authorId)!;
}

export function getReportAuthor(id: string): string | undefined {
  const row = reportExists.get(id) as { author_id: string } | undefined;
  return row?.author_id;
}

export function deleteReport(id: string, authorId: string): boolean {
  return deleteReportStmt.run(id, authorId).changes > 0;
}

/** Returns true when a new vote was inserted (false if it already existed). */
export function addReportVote(reportId: string, userId: string): boolean {
  return insertVote.run(reportId, userId, nowMs()).changes > 0;
}

export function removeReportVote(reportId: string, userId: string): void {
  deleteVote.run(reportId, userId);
}

export function reportVoteCount(reportId: string): number {
  return (countVotes.get(reportId) as { c: number }).c;
}
