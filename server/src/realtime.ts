import type { Server } from "socket.io";
import type {
  ClientToServerEvents,
  ReportDTO,
  ServerToClientEvents,
} from "@safesips/shared";

/** Per-socket data. `publicId` stays anonymous; `userId` is server-side only. */
export interface SocketData {
  /** Anonymous, per-connection id broadcast in presence records. */
  publicId: string;
  /** Authenticated owner — NEVER placed into any presence:* payload. */
  userId: string;
  lastUpdateAt: number;
}

type IO = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

let io: IO | null = null;

/** userId -> set of live socket ids (for targeting check-in prompts). */
const socketsByUser = new Map<string, Set<string>>();

export function setIo(server: IO): void {
  io = server;
}

export function trackUserSocket(userId: string, socketId: string): void {
  let set = socketsByUser.get(userId);
  if (!set) {
    set = new Set();
    socketsByUser.set(userId, set);
  }
  set.add(socketId);
}

export function untrackUserSocket(userId: string, socketId: string): void {
  const set = socketsByUser.get(userId);
  if (!set) return;
  set.delete(socketId);
  if (set.size === 0) socketsByUser.delete(userId);
}

/**
 * Broadcast a newly published safety report to everyone. A report intentionally
 * carries an EXACT point + author display name (a deliberate public publish) —
 * `viewerHasVoted` is false at creation for all recipients.
 */
export function broadcastReportNew(report: ReportDTO): void {
  io?.emit("report:new", report);
}

export function broadcastReportRemoved(id: string): void {
  io?.emit("report:removed", { id });
}

/** Push a check-in prompt to a specific user's live sockets (if any). */
export function emitCheckinDue(
  userId: string,
  data: {
    occurrenceId: string;
    planId: string;
    question: string;
    deadlineAt: number;
  }
): void {
  const set = socketsByUser.get(userId);
  if (!set || !io) return;
  for (const socketId of set) {
    io.to(socketId).emit("checkin:due", data);
  }
}
