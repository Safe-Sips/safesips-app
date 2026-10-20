import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_SHARE_DURATION_MS,
  distanceMeters,
  LatLng,
  LIVE_MAX_ACCURACY_M,
  maskLocation,
  PRESENCE_HEARTBEAT_MS,
  PresenceRecord,
  SHARE_MAX_DURATION_MS,
  shouldMoveCircle,
} from "@safesips/shared";
import { useSocket, type ConnectionState } from "../socket/SocketProvider";

export type { ConnectionState } from "../socket/SocketProvider";

const DURATION_KEY = "safesips.shareDurationMs";

/** Minimum gap between two emits we trigger ourselves (server limit is 2 s). */
const MIN_EMIT_GAP_MS = 3_000;

/*
 * Live circle: while sharing and the app is on screen, a low-power location
 * watch moves the circle as you move (rules: shouldMoveCircle in shared/live).
 * Coarse positioning (no GPS) is plenty for a ~200 m circle and far cheaper on
 * battery; the watch stops when sharing stops or the app is backgrounded.
 */
/** Only redraw the private blue dot for moves at least this big. */
const LIVE_DOT_STEP_M = 10;

/** Shown when a timed "share for" window runs out, from whichever path notices. */
const SHARE_ENDED_NOTICE = "Location sharing ended (the time you chose is up).";

export interface PresenceState {
  connection: ConnectionState;
  selfId: string | null;
  /** Public presence records of *other* users (self is excluded). */
  others: PresenceRecord[];
  /** This client's own masked public center, if currently sharing. */
  selfPublic: LatLng | null;
  /**
   * This device's exact position while sharing (the private blue dot).
   * Local memory only — never emitted; only `selfPublic` leaves the device.
   */
  exact: LatLng | null;
  lastUpdateAt: number | null;
  /**
   * Epoch ms when the current share ends on its own ("share for 1 hour").
   * null in live mode or when not sharing.
   */
  sharedUntil: number | null;
  /** Selected "share for" duration in ms; 0 = live (only while app is open). */
  durationMs: number;
  notice: string | null;
}

function activeRecords(map: Map<string, PresenceRecord>): PresenceRecord[] {
  const now = Date.now();
  return Array.from(map.values()).filter((r) => r.expiresAt > now);
}

function readStoredDuration(): number {
  try {
    const raw = localStorage.getItem(DURATION_KEY);
    if (raw == null) return DEFAULT_SHARE_DURATION_MS;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0
      ? Math.min(parsed, SHARE_MAX_DURATION_MS)
      : DEFAULT_SHARE_DURATION_MS;
  } catch {
    return DEFAULT_SHARE_DURATION_MS;
  }
}

export interface PresenceApi {
  state: PresenceState;
  publish: (exact: LatLng, remask?: boolean) => void;
  stop: () => void;
  clearNotice: () => void;
  /** Change the "share for" duration. If already sharing, restarts the timer. */
  setDurationMs: (ms: number) => void;
}

const PresenceContext = createContext<PresenceApi | null>(null);

/**
 * Presence state on top of the shared authenticated socket.
 *
 * The exact location passed to `publish` is masked locally; only the masked
 * center is ever emitted.
 *
 * Two modes:
 *  - Live (duration 0): heartbeats keep the circle visible; if they stop
 *    (phone locked, tab closed) the server drops it after its grace period.
 *  - Share for N hours: every update also tells the server how long to keep
 *    the circle, so it stays up even while the phone sleeps, then ends on time.
 *
 * Must live above page routes (see PresenceProvider) so leaving the map tab
 * does not tear down heartbeats. Signing out removes the circle immediately.
 */
function usePresenceController(): PresenceApi {
  const { socket, connection } = useSocket();
  const [selfId, setSelfId] = useState<string | null>(null);
  const [records, setRecords] = useState<Map<string, PresenceRecord>>(new Map());
  const [selfPublic, setSelfPublic] = useState<LatLng | null>(null);
  const [exact, setExact] = useState<LatLng | null>(null);
  /** Exact position the current circle was last masked from. */
  const lastPublishedExactRef = useRef<LatLng | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [sharedUntil, setSharedUntil] = useState<number | null>(null);
  const [durationMs, setDurationState] = useState<number>(readStoredDuration);
  const [notice, setNotice] = useState<string | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const maskedRef = useRef<LatLng | null>(null);
  const shareStartedAtRef = useRef<number | null>(null);
  const sharingRef = useRef(false);
  const holdUntilRef = useRef<number | null>(null);
  const durationRef = useRef(durationMs);
  const lastEmitRef = useRef(0);

  const stopLocal = useCallback(() => {
    sharingRef.current = false;
    maskedRef.current = null;
    shareStartedAtRef.current = null;
    holdUntilRef.current = null;
    lastPublishedExactRef.current = null;
    setSelfPublic(null);
    setExact(null);
    setLastUpdateAt(null);
    setSharedUntil(null);
  }, []);

  const emitMasked = useCallback(
    (masked: LatLng) => {
      const now = Date.now();
      const holdUntil = holdUntilRef.current;
      setSelfPublic(masked);
      setLastUpdateAt(now);
      setNotice(null);
      lastEmitRef.current = now;
      if (holdUntil) {
        socket?.emit("location:update", {
          ...masked,
          holdMs: Math.max(1, holdUntil - now),
        });
      } else {
        socket?.emit("location:update", masked);
      }
    },
    [socket]
  );

  const stop = useCallback(() => {
    socket?.emit("location:stop");
    stopLocal();
  }, [socket, stopLocal]);

  /** True (and stops locally) if a timed share has run out. */
  const endIfExpired = useCallback((): boolean => {
    const holdUntil = holdUntilRef.current;
    if (sharingRef.current && holdUntil && Date.now() >= holdUntil) {
      stop();
      setNotice(SHARE_ENDED_NOTICE);
      return true;
    }
    return false;
  }, [stop]);

  useEffect(() => {
    if (!socket) return;

    const onSelf = ({ publicId }: { publicId: string }) => {
      selfIdRef.current = publicId;
      setSelfId(publicId);
    };
    const onInit = (incoming: PresenceRecord[]) => {
      setRecords(new Map(incoming.map((r) => [r.publicId, r])));
    };
    const onUpsert = (record: PresenceRecord) => {
      setRecords((prev) => {
        const next = new Map(prev);
        next.set(record.publicId, record);
        return next;
      });
    };
    const onRemove = ({ publicId }: { publicId: string }) => {
      setRecords((prev) => {
        if (!prev.has(publicId)) return prev;
        const next = new Map(prev);
        next.delete(publicId);
        return next;
      });
      // Our own timed share was expired by the server.
      if (
        publicId === selfIdRef.current &&
        holdUntilRef.current &&
        Date.now() >= holdUntilRef.current - 5_000
      ) {
        stopLocal();
        setNotice(SHARE_ENDED_NOTICE);
      }
    };
    const onResume = (data: {
      publicId: string;
      lat: number;
      lng: number;
      holdRemainingMs: number;
    }) => {
      // That circle is ours, not "someone nearby".
      setRecords((prev) => {
        if (!prev.has(data.publicId)) return prev;
        const next = new Map(prev);
        next.delete(data.publicId);
        return next;
      });
      // Same page reconnecting: onConnect already re-published.
      if (sharingRef.current) return;
      const now = Date.now();
      maskedRef.current = { lat: data.lat, lng: data.lng };
      sharingRef.current = true;
      shareStartedAtRef.current = now;
      holdUntilRef.current =
        data.holdRemainingMs > 0 ? now + data.holdRemainingMs : null;
      setSharedUntil(holdUntilRef.current);
      // Re-publish from this connection so the server moves the circle here.
      emitMasked(maskedRef.current);
    };
    const onNotice = ({
      code,
      message,
    }: {
      code: string;
      message: string;
    }) => {
      setNotice(message);
      if (code === "share_expired") stopLocal();
    };

    const onConnect = () => {
      // Re-publish immediately on reconnect so presence returns without
      // waiting for the next heartbeat.
      if (sharingRef.current && maskedRef.current && !endIfExpired()) {
        emitMasked(maskedRef.current);
      }
    };

    socket.on("presence:self", onSelf);
    socket.on("presence:init", onInit);
    socket.on("presence:upsert", onUpsert);
    socket.on("presence:remove", onRemove);
    socket.on("presence:resume", onResume);
    socket.on("error:notice", onNotice);
    socket.on("connect", onConnect);

    return () => {
      socket.off("presence:self", onSelf);
      socket.off("presence:init", onInit);
      socket.off("presence:upsert", onUpsert);
      socket.off("presence:remove", onRemove);
      socket.off("presence:resume", onResume);
      socket.off("error:notice", onNotice);
      socket.off("connect", onConnect);
    };
  }, [socket, stopLocal, emitMasked, endIfExpired]);

  // Drop stale records so other users disappear when their TTL expires.
  useEffect(() => {
    const id = window.setInterval(() => {
      setRecords((prev) => {
        const live = activeRecords(prev);
        if (live.length === prev.size) return prev;
        return new Map(live.map((r) => [r.publicId, r]));
      });
    }, 10_000);
    return () => window.clearInterval(id);
  }, []);

  const publish = useCallback(
    (exact: LatLng, remask = true) => {
      const masked =
        remask || !maskedRef.current
          ? maskLocation(exact.lat, exact.lng)
          : maskedRef.current;
      maskedRef.current = masked;
      lastPublishedExactRef.current = exact;
      setExact(exact);
      if (!sharingRef.current) {
        // Starting a new share: start the clock for the chosen duration.
        const now = Date.now();
        shareStartedAtRef.current = now;
        holdUntilRef.current =
          durationRef.current > 0 ? now + durationRef.current : null;
        setSharedUntil(holdUntilRef.current);
      }
      sharingRef.current = true;
      emitMasked(masked);
    },
    [emitMasked]
  );

  const setDurationMs = useCallback(
    (ms: number) => {
      const value = Math.max(0, Math.min(ms, SHARE_MAX_DURATION_MS));
      durationRef.current = value;
      setDurationState(value);
      try {
        localStorage.setItem(DURATION_KEY, String(value));
      } catch {
        /* storage unavailable: keep in memory only */
      }
      if (sharingRef.current && maskedRef.current) {
        holdUntilRef.current = value > 0 ? Date.now() + value : null;
        setSharedUntil(holdUntilRef.current);
        emitMasked(maskedRef.current);
      }
    },
    [emitMasked]
  );

  // Heartbeat: keep this user's presence fresh while sharing.
  useEffect(() => {
    if (!sharingRef.current || !maskedRef.current) return;
    const id = window.setInterval(() => {
      if (!sharingRef.current || !maskedRef.current) return;
      if (
        shareStartedAtRef.current &&
        Date.now() - shareStartedAtRef.current >= SHARE_MAX_DURATION_MS
      ) {
        stop();
        setNotice("Location sharing stopped after 24 hours.");
        return;
      }
      if (endIfExpired()) return;
      emitMasked(maskedRef.current);
    }, PRESENCE_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [selfPublic, emitMasked, stop, endIfExpired]);

  // Live circle: follow the user while sharing and the app is on screen.
  const sharing = selfPublic !== null;
  useEffect(() => {
    if (!sharing || !("geolocation" in navigator)) return;
    let watchId: number | null = null;

    const onFix = (pos: GeolocationPosition) => {
      if (!sharingRef.current) return;
      const { latitude, longitude, accuracy } = pos.coords;
      if (accuracy > LIVE_MAX_ACCURACY_M) return; // too coarse to be useful
      const here = { lat: latitude, lng: longitude };

      // Private blue dot (local only): redraw on meaningful moves.
      setExact((prev) =>
        prev && distanceMeters(prev, here) < LIVE_DOT_STEP_M ? prev : here
      );

      const move = shouldMoveCircle({
        lastPublished: lastPublishedExactRef.current,
        here,
        accuracyMeters: accuracy,
        msSinceLastPublish: Date.now() - lastEmitRef.current,
      });
      if (!move || endIfExpired()) return;
      publish(here); // fresh mask around the new position
    };

    const start = () => {
      if (watchId !== null || document.visibilityState !== "visible") return;
      watchId = navigator.geolocation.watchPosition(
        onFix,
        () => {
          /* transient error: keep the last circle; Update still works */
        },
        { enableHighAccuracy: false, maximumAge: 30_000, timeout: 60_000 }
      );
    };
    const stopWatch = () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      watchId = null;
    };
    const onVisibility = () =>
      document.visibilityState === "visible" ? start() : stopWatch();

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stopWatch();
    };
  }, [sharing, publish, endIfExpired]);

  // End a timed share exactly on time while the page is open.
  useEffect(() => {
    if (!sharedUntil) return;
    const id = window.setTimeout(
      () => endIfExpired(),
      Math.max(0, sharedUntil - Date.now()) + 250
    );
    return () => window.clearTimeout(id);
  }, [sharedUntil, endIfExpired]);

  // When the user comes back to the tab/app, refresh right away instead of
  // waiting for a (possibly throttled) heartbeat.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (!sharingRef.current || !maskedRef.current) return;
      if (endIfExpired()) return;
      if (Date.now() - lastEmitRef.current < MIN_EMIT_GAP_MS) return;
      emitMasked(maskedRef.current);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [emitMasked, endIfExpired]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const others = useMemo(
    () =>
      activeRecords(records).filter(
        (r) => r.publicId !== selfIdRef.current
      ),
    [records, selfId]
  );

  const state: PresenceState = {
    connection,
    selfId,
    others,
    selfPublic,
    exact,
    lastUpdateAt,
    sharedUntil,
    durationMs,
    notice,
  };

  return { state, publish, stop, clearNotice, setDurationMs };
}

/** Owns sharing/heartbeats for the whole authenticated session. */
export function PresenceProvider({ children }: { children: ReactNode }) {
  const value = usePresenceController();
  return (
    <PresenceContext.Provider value={value}>{children}</PresenceContext.Provider>
  );
}

export function usePresence(): PresenceApi {
  const ctx = useContext(PresenceContext);
  if (!ctx) {
    throw new Error("usePresence must be used within PresenceProvider");
  }
  return ctx;
}
