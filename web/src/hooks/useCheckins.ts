import { useCallback, useEffect, useState } from "react";
import type { CheckinAnswerResult, CheckinOccurrenceDTO } from "@safesips/shared";
import { api } from "../api";
import { useSocket } from "../socket/SocketProvider";

const POLL_MS = 30_000;

/**
 * Tracks the user's currently-due check-in. The server scheduler is the source
 * of truth (it escalates even if the app is closed); the socket `checkin:due`
 * event is a fast nudge, and polling covers reconnects / other devices.
 */
export function useCheckins() {
  const { socket } = useSocket();
  const [active, setActive] = useState<CheckinOccurrenceDTO | null>(null);

  const refresh = useCallback(async () => {
    try {
      const { occurrence } = await api.activeCheckin();
      setActive(occurrence);
    } catch {
      // ignore transient errors
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    const onDue = () => refresh();
    socket.on("checkin:due", onDue);
    return () => {
      socket.off("checkin:due", onDue);
    };
  }, [socket, refresh]);

  const answer = useCallback(
    async (occurrenceId: string, value: string): Promise<CheckinAnswerResult> => {
      const res = await api.answerCheckin(occurrenceId, value);
      if (res.correct || res.expired) setActive(null);
      return res;
    },
    []
  );

  return { active, refresh, answer };
}
