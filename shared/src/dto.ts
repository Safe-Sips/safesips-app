/**
 * Data-transfer objects shared by the web client and the REST API, so both
 * sides agree on the exact shapes. These are plain TypeScript interfaces (no
 * runtime validation library) to keep the web bundle lean — the server
 * validates inputs with zod separately.
 *
 * PRIVACY NOTE: unlike `PresenceRecord` (a masked, anonymous circle), a
 * `ReportDTO` intentionally carries an EXACT public point and the author's
 * display name. A report is a deliberate, user-confirmed publish — it is never
 * auto-derived from a user's presence/location sharing.
 */

import type { BadgeTier, EngagementCounts } from "./badges";

/* --------------------------------- Auth --------------------------------- */

export interface UserDTO {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  createdAt: number;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  captchaToken?: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: UserDTO;
  /** Present only in development to ease testing without a real mailbox. */
  verifyUrl?: string;
}

export interface UserStatsDTO {
  counts: EngagementCounts;
  score: number;
  badge: BadgeTier;
}

/* -------------------------------- Reports ------------------------------- */

export type ReportSafety = "safe" | "unsafe";

export interface ReportInput {
  /** EXACT point being reported (intentional public publish). */
  lat: number;
  lng: number;
  safety: ReportSafety;
  category?: string | null;
  note?: string | null;
  placeLabel?: string | null;
}

export interface ReportDTO {
  id: string;
  /** EXACT, public-by-intent point of the reported spot. */
  lat: number;
  lng: number;
  safety: ReportSafety;
  category: string | null;
  note: string | null;
  placeLabel: string | null;
  authorId: string;
  authorDisplayName: string;
  voteCount: number;
  /** Whether the requesting user has upvoted this report. */
  viewerHasVoted: boolean;
  createdAt: number;
}

/* ------------------------------ Safe havens ----------------------------- */

export type SafeHavenKind =
  | "police"
  | "hospital"
  | "fire_station"
  | "fuel"
  | "pharmacy"
  | "other";

export interface SafeHavenDTO {
  id: string;
  kind: SafeHavenKind;
  name: string | null;
  lat: number;
  lng: number;
  distanceMeters: number;
  phone: string | null;
  openingHours: string | null;
  isOpen24_7: boolean;
}

/* --------------------------------- Forum -------------------------------- */

export interface ThreadInput {
  title: string;
  body: string;
  category?: string;
}

export interface ThreadDTO {
  id: string;
  title: string;
  category: string;
  authorId: string;
  authorDisplayName: string;
  postCount: number;
  createdAt: number;
  lastPostAt: number;
}

export interface PostInput {
  body: string;
}

export interface PostDTO {
  id: string;
  threadId: string;
  body: string;
  authorId: string;
  authorDisplayName: string;
  voteCount: number;
  viewerHasVoted: boolean;
  createdAt: number;
}

export interface ThreadDetailDTO {
  thread: ThreadDTO;
  posts: PostDTO[];
}

/* ------------------------------- Activity ------------------------------- */

export type ActivityKind =
  | "report_created"
  | "report_upvoted"
  | "thread_created"
  | "post_created"
  | "checkin_completed";

export interface ActivityDTO {
  id: string;
  kind: ActivityKind;
  refId: string | null;
  /** Optional human context (e.g. a thread title or place label). */
  context: string | null;
  createdAt: number;
}

/* ----------------------------- SOS contacts ----------------------------- */

export interface SosContactInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  isPrimary?: boolean;
}

export interface SosContactDTO {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
  createdAt: number;
}

/* ------------------------------- Check-ins ------------------------------ */

export type CheckinPlanStatus = "active" | "paused" | "ended";

export interface CheckinPlanInput {
  label?: string | null;
  intervalMinutes: number;
  graceMinutes: number;
  question: string;
  /** The expected answer — hashed server-side, never stored in plaintext. */
  answer: string;
  endsAt?: number | null;
}

export interface PlanDTO {
  id: string;
  label: string | null;
  intervalMinutes: number;
  graceMinutes: number;
  question: string;
  status: CheckinPlanStatus;
  startedAt: number;
  endsAt: number | null;
  createdAt: number;
  /** Due time of the next pending/prompted occurrence, if any. */
  nextDueAt: number | null;
}

export type CheckinOccurrenceStatus =
  | "pending"
  | "prompted"
  | "answered"
  | "missed"
  | "escalated";

export interface CheckinOccurrenceDTO {
  id: string;
  planId: string;
  question: string;
  dueAt: number;
  deadlineAt: number;
  status: CheckinOccurrenceStatus;
  promptedAt: number | null;
  answeredAt: number | null;
}

export interface CheckinAnswerResult {
  correct: boolean;
  /** True when the deadline has already passed (answer no longer accepted). */
  expired: boolean;
  occurrence: CheckinOccurrenceDTO | null;
}

/* ------------------------------- Waitlist ------------------------------- */

export interface WaitlistInput {
  name: string;
  email: string;
  country?: string;
  interest?: string;
  captchaToken?: string;
}

/* -------------------------------- Generic ------------------------------- */

export interface OkResponse {
  ok: true;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
}
