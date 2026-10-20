import type {
  ActivityDTO,
  CheckinAnswerResult,
  CheckinOccurrenceDTO,
  CheckinPlanInput,
  PlanDTO,
  PostDTO,
  ReportDTO,
  ReportInput,
  SafeHavenDTO,
  CheckinAlertDTO,
  ContactsOverviewDTO,
  FriendProfileDTO,
  FriendsOverviewDTO,
  UserSearchResultDTO,
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

/**
 * Fire-and-forget request so a sleeping API host starts waking up while the
 * page and Clerk are still loading, instead of after sign-in.
 */
export function warmUpApi(): void {
  try {
    void fetch(`${API_BASE}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

let authToken: string | null = null;
type TokenGetter = () => Promise<string | null>;
let tokenGetter: TokenGetter | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

/** Clerk (or other) async token source. Preferred over a static token. */
export function setTokenGetter(fn: TokenGetter | null): void {
  tokenGetter = fn;
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
  const token = tokenGetter ? await tokenGetter() : authToken;
  if (token) headers["Authorization"] = `Bearer ${token}`;

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

export interface PostVoteResult {
  /** Net score (upvotes minus downvotes). */
  voteCount: number;
  /** Viewer's current vote: 1, -1, or 0. */
  viewerVote: number;
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
  me: () => request<{ user: UserDTO }>("/api/auth/me"),

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
  votePost: (id: string, value: 1 | -1) =>
    request<PostVoteResult>(`/api/forum/posts/${id}/vote`, {
      method: "POST",
      body: { value },
    }),
  unvotePost: (id: string) =>
    request<PostVoteResult>(`/api/forum/posts/${id}/vote`, { method: "DELETE" }),

  // Profile
  stats: () => request<UserStatsDTO>("/api/users/me/stats"),
  /** GDPR export: everything stored about the signed-in account. */
  exportMyData: () => request<unknown>("/api/users/me/export"),
  /** GDPR erasure. Irreversible. */
  deleteAccount: () =>
    request<{ ok: true; clerkDeleted: boolean }>("/api/users/me", {
      method: "DELETE",
      body: { confirm: "DELETE" },
    }),
  activity: (cursor?: number) =>
    request<ActivityDTO[]>(`/api/users/me/activity${cursor ? `?cursor=${cursor}` : ""}`),

  // Emergency contacts (other SafeSips users)
  contacts: () => request<ContactsOverviewDTO>("/api/contacts"),
  addContact: (identifier: string) =>
    request<{ message: string; overview: ContactsOverviewDTO }>("/api/contacts", {
      body: { identifier },
    }),
  acceptContact: (id: string) =>
    request<ContactsOverviewDTO>(`/api/contacts/${id}/accept`, { method: "POST", body: {} }),
  removeContact: (id: string) =>
    request<ContactsOverviewDTO>(`/api/contacts/${id}`, { method: "DELETE" }),

  // Friends (other SafeSips users) and their profiles
  friends: () => request<FriendsOverviewDTO>("/api/friends"),
  addFriend: (identifier: string) =>
    request<{ message: string; overview: FriendsOverviewDTO }>("/api/friends", {
      body: { identifier },
    }),
  addFriendById: (userId: string) =>
    request<{ message: string; overview: FriendsOverviewDTO }>("/api/friends", { body: { userId } }),
  searchUsers: (q: string) =>
    request<{ results: UserSearchResultDTO[] }>(`/api/friends/search?q=${encodeURIComponent(q)}`),
  setDiscoverable: (discoverable: boolean) =>
    request<FriendsOverviewDTO>("/api/friends/settings", { method: "PUT", body: { discoverable } }),
  acceptFriend: (id: string) =>
    request<FriendsOverviewDTO>(`/api/friends/${encodeURIComponent(id)}/accept`, { method: "POST", body: {} }),
  removeFriend: (id: string) =>
    request<FriendsOverviewDTO>(`/api/friends/${encodeURIComponent(id)}`, { method: "DELETE" }),
  setAvatar: (imageUrl: string | null) =>
    request<{ imageUrl: string | null }>("/api/users/me/avatar", { method: "PUT", body: { imageUrl } }),
  friendProfile: (userId: string) =>
    request<FriendProfileDTO>(`/api/friends/${encodeURIComponent(userId)}/profile`),
  askFriendAsContact: (userId: string) =>
    request<FriendProfileDTO>(`/api/friends/${encodeURIComponent(userId)}/emergency-contact`, {
      method: "POST",
      body: {},
    }),

  // Alerts I received as someone's emergency contact
  alerts: () => request<{ alerts: CheckinAlertDTO[]; unread: number }>("/api/alerts"),
  ackAlert: (id: string) =>
    request<{ alerts: CheckinAlertDTO[]; unread: number }>(`/api/alerts/${id}/ack`, {
      method: "POST",
      body: {},
    }),

  // Push notifications
  pushPublicKey: () => request<{ publicKey: string }>("/api/push/public-key"),
  pushSubscribe: (sub: PushSubscriptionJSON) =>
    request<{ ok: true }>("/api/push/subscribe", { body: sub }),
  pushUnsubscribe: (endpoint: string) =>
    request<{ ok: true }>("/api/push/unsubscribe", { body: { endpoint } }),

  // Check-ins
  listPlans: () => request<PlanDTO[]>("/api/checkins/plans"),
  createPlan: (input: CheckinPlanInput) =>
    request<PlanDTO>("/api/checkins/plans", { body: input }),
  setPlanContacts: (id: string, contactUserIds: string[] | null) =>
    request<PlanDTO>(`/api/checkins/plans/${encodeURIComponent(id)}/contacts`, {
      method: "PUT",
      body: { contactUserIds },
    }),
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
