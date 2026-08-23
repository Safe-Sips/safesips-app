import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LatLng,
  maskLocation,
  PRESENCE_HEARTBEAT_MS,
  PresenceRecord,
  SHARE_MAX_DURATION_MS,
} from "@safesips/shared";
import { useSocket, type ConnectionState } from "../socket/SocketProvider";

export type { ConnectionState } from "../socket/SocketProvider";

export interface PresenceState {
  connection: ConnectionState;
  selfId: string | null;
  /** Public presence records of *other* users (self is excluded). */
  others: PresenceRecord[];
  /** This client's own masked public center, if currently sharing. */
  selfPublic: LatLng | null;
  lastUpdateAt: number | null;
  notice: string | null;
}

function activeRecords(map: Map<string, PresenceRecord>): PresenceRecord[] {
  const now = Date.now();
  return Array.from(map.values()).filter((r) => r.expiresAt > now);
}

/**
 * Presence state on top of the shared authenticated socket.
 *
 * The exact location passed to `publish` is masked locally; only the masked
 * center is ever emitted. While sharing, a heartbeat keeps the record visible
 * to all connected users. Sharing auto-stops after 24 hours.
 */
export function usePresence() {
  const { socket, connection } = useSocket();
  const [selfId, setSelfId] = useState<string | null>(null);
  const [records, setRecords] = useState<Map<string, PresenceRecord>>(new Map());
  const [selfPublic, setSelfPublic] = useState<LatLng | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const maskedRef = useRef<LatLng | null>(null);
  const shareStartedAtRef = useRef<number | null>(null);
  const sharingRef = useRef(false);

  const stopLocal = useCallback(() => {
    sharingRef.current = false;
    maskedRef.current = null;
    shareStartedAtRef.current = null;
    setSelfPublic(null);
    setLastUpdateAt(null);
  }, []);

  const emitMasked = useCallback(
    (masked: LatLng) => {
      setSelfPublic(masked);
      setLastUpdateAt(Date.now());
      setNotice(null);
      socket?.emit("location:update", masked);
    },
    [socket]
  );

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

    socket.on("presence:self", onSelf);
    socket.on("presence:init", onInit);
    socket.on("presence:upsert", onUpsert);
    socket.on("presence:remove", onRemove);
    socket.on("error:notice", onNotice);

    return () => {
      socket.off("presence:self", onSelf);
      socket.off("presence:init", onInit);
      socket.off("presence:upsert", onUpsert);
      socket.off("presence:remove", onRemove);
      socket.off("error:notice", onNotice);
    };
  }, [socket, stopLocal]);

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
      if (!shareStartedAtRef.current) shareStartedAtRef.current = Date.now();
      sharingRef.current = true;
      emitMasked(masked);
    },
    [emitMasked]
  );

  const stop = useCallback(() => {
    socket?.emit("location:stop");
    stopLocal();
  }, [socket, stopLocal]);

  // Heartbeat: keep this user's presence visible to everyone while sharing.
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
      emitMasked(maskedRef.current);
    }, PRESENCE_HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, [selfPublic, emitMasked, stop]);

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
    lastUpdateAt,
    notice,
  };

  return { state, publish, stop, clearNotice };
}
