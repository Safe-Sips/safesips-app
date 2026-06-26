import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LatLng, maskLocation, PresenceRecord } from "@safesips/shared";
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

/**
 * Presence state on top of the shared authenticated socket.
 *
 * The exact location passed to `publish` is masked locally; only the masked
 * center is ever emitted. The socket is authenticated, but the broadcast
 * presence records stay anonymous (no account identity on the wire).
 */
export function usePresence() {
  const { socket, connection } = useSocket();
  const [selfId, setSelfId] = useState<string | null>(null);
  const [records, setRecords] = useState<Map<string, PresenceRecord>>(new Map());
  const [selfPublic, setSelfPublic] = useState<LatLng | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const selfIdRef = useRef<string | null>(null);

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
    const onNotice = ({ message }: { message: string }) => setNotice(message);

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
  }, [socket]);

  const publish = useCallback(
    (exact: LatLng) => {
      const masked = maskLocation(exact.lat, exact.lng);
      setSelfPublic(masked);
      setLastUpdateAt(Date.now());
      setNotice(null);
      socket?.emit("location:update", masked);
    },
    [socket]
  );

  const stop = useCallback(() => {
    socket?.emit("location:stop");
    setSelfPublic(null);
    setLastUpdateAt(null);
  }, [socket]);

  const clearNotice = useCallback(() => setNotice(null), []);

  const others = useMemo(
    () =>
      Array.from(records.values()).filter(
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
