import type {
  ActivityDTO,
  AuthResponse,
  CheckinAnswerResult,
  CheckinOccurrenceDTO,
  CheckinPlanInput,
  LoginInput,
  PlanDTO,
  PostDTO,
  RegisterInput,
  ReportDTO,
  ReportInput,
  SafeHavenDTO,
  SosContactDTO,
  SosContactInput,
  ThreadDTO,
  ThreadDetailDTO,
  UserDTO,
  UserStatsDTO,
  WaitlistInput,
} from "@safesips/shared";

const API_BASE = (
  import.meta.env.VITE_API_URL ??
  import.meta.env.VITE_SERVER_URL ??
  "http://localhost:4000"
).replace(/\/+$/, "");

let authToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Register a callback fired whenever the API returns 401 (token invalid). */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
}

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers["Authorization"] = `Bearer ${authToken}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401) unauthorizedHandler?.();

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const body = data as { error?: string; code?: string } | null;
    throw new ApiError(
      body?.error ?? `Request failed (${res.status})`,
      res.status,
      body?.code
    );
  }
  return data as T;
}

export interface VoteResult {
  voteCount: number;
  viewerHasVoted: boolean;
}

export interface SafeHavensResult {
  havens: SafeHavenDTO[];
  cached?: boolean;
  error?: string;
  emergencyNumber?: string;
}

export const api = {
  base: API_BASE,

  // Auth
  register: (input: RegisterInput) =>
    request<AuthResponse>("/api/auth/register", { body: input }),
  login: (input: LoginInput) =>
    request<AuthResponse>("/api/auth/login", { body: input }),
  verify: (token: string) =>
    request<{ ok: true }>("/api/auth/verify", { body: { token } }),
  me: () => request<{ user: UserDTO }>("/api/auth/me"),
  logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  resendVerification: () =>
    request<{ ok: true; verifyUrl?: string }>("/api/auth/resend-verification", {
      method: "POST",
    }),

  // Reports
  listReports: (bbox?: string) =>
    request<ReportDTO[]>(`/api/reports${bbox ? `?bbox=${encodeURIComponent(bbox)}` : ""}`),
  createReport: (input: ReportInput) =>
    request<ReportDTO>("/api/reports", { body: input }),
  voteReport: (id: string) =>
    request<VoteResult>(`/api/reports/${id}/vote`, { method: "POST" }),
  unvoteReport: (id: string) =>
    request<VoteResult>(`/api/reports/${id}/vote`, { method: "DELETE" }),
  deleteReport: (id: string) =>
    request<{ ok: true }>(`/api/reports/${id}`, { method: "DELETE" }),

  // Safe havens
  safeHavens: (lat: number, lng: number, radius?: number) =>
    request<SafeHavensResult>(
      `/api/safe-havens?lat=${lat}&lng=${lng}${radius ? `&radius=${radius}` : ""}`
    ),

  // Forum
  listThreads: (cursor?: number) =>
    request<ThreadDTO[]>(`/api/forum/threads${cursor ? `?cursor=${cursor}` : ""}`),
  createThread: (input: { title: string; body: string; category?: string }) =>
    request<ThreadDTO>("/api/forum/threads", { body: input }),
  getThread: (id: string) =>
    request<ThreadDetailDTO>(`/api/forum/threads/${id}`),
  createPost: (threadId: string, body: string) =>
    request<PostDTO>(`/api/forum/threads/${threadId}/posts`, { body: { body } }),
  votePost: (id: string) =>
    request<VoteResult>(`/api/forum/posts/${id}/vote`, { method: "POST" }),
  unvotePost: (id: string) =>
    request<VoteResult>(`/api/forum/posts/${id}/vote`, { method: "DELETE" }),

  // Profile
  stats: () => request<UserStatsDTO>("/api/users/me/stats"),
  activity: (cursor?: number) =>
    request<ActivityDTO[]>(`/api/users/me/activity${cursor ? `?cursor=${cursor}` : ""}`),

  // SOS contacts
  listContacts: () => request<SosContactDTO[]>("/api/sos-contacts"),
  createContact: (input: SosContactInput) =>
    request<SosContactDTO>("/api/sos-contacts", { body: input }),
  deleteContact: (id: string) =>
    request<{ ok: true }>(`/api/sos-contacts/${id}`, { method: "DELETE" }),

  // Check-ins
  listPlans: () => request<PlanDTO[]>("/api/checkins/plans"),
  createPlan: (input: CheckinPlanInput) =>
    request<PlanDTO>("/api/checkins/plans", { body: input }),
  pausePlan: (id: string) =>
    request<{ ok: true }>(`/api/checkins/plans/${id}/pause`, { method: "POST" }),
  endPlan: (id: string) =>
    request<{ ok: true }>(`/api/checkins/plans/${id}/end`, { method: "POST" }),
  activeCheckin: () =>
    request<{ occurrence: CheckinOccurrenceDTO | null }>("/api/checkins/active"),
  answerCheckin: (id: string, answer: string) =>
    request<CheckinAnswerResult>(`/api/checkins/occurrences/${id}/answer`, {
      body: { answer },
    }),
  listOccurrences: (cursor?: number) =>
    request<CheckinOccurrenceDTO[]>(
      `/api/checkins/occurrences${cursor ? `?cursor=${cursor}` : ""}`
    ),

  // Waitlist (public)
  waitlist: (input: WaitlistInput) =>
    request<{ ok: true }>("/api/waitlist", { body: input }),
};
