import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LatLng, maskLocation, PresenceRecord } from "@safesips/shared";
import { createSocket, type AppSocket } from "./socket";

export type ConnectionState = "connecting" | "connected" | "disconnected";

/**
 * Owns the socket connection and presence state on mobile.
 * Exact coordinates passed to `publish` are masked locally; only the masked
 * center is emitted.
 */
export function usePresence() {
  const socketRef = useRef<AppSocket | null>(null);
  const selfIdRef = useRef<string | null>(null);

  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [selfId, setSelfId] = useState<string | null>(null);
  const [records, setRecords] = useState<Map<string, PresenceRecord>>(
    new Map()
  );
  const [selfPublic, setSelfPublic] = useState<LatLng | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on("connect", () => setConnection("connected"));
    socket.on("disconnect", () => setConnection("disconnected"));
    socket.io.on("reconnect_attempt", () => setConnection("connecting"));

    socket.on("presence:self", ({ publicId }) => {
      selfIdRef.current = publicId;
      setSelfId(publicId);
    });
    socket.on("presence:init", (incoming) => {
      setRecords(new Map(incoming.map((r) => [r.publicId, r])));
    });
    socket.on("presence:upsert", (record) => {
      setRecords((prev) => {
        const next = new Map(prev);
        next.set(record.publicId, record);
        return next;
      });
    });
    socket.on("presence:remove", ({ publicId }) => {
      setRecords((prev) => {
        if (!prev.has(publicId)) return prev;
        const next = new Map(prev);
        next.delete(publicId);
        return next;
      });
    });
    socket.on("error:notice", ({ message }) => setNotice(message));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const publish = useCallback((exact: LatLng) => {
    const masked = maskLocation(exact.lat, exact.lng);
    setSelfPublic(masked);
    setLastUpdateAt(Date.now());
    setNotice(null);
    socketRef.current?.emit("location:update", masked);
  }, []);

  const stop = useCallback(() => {
    socketRef.current?.emit("location:stop");
    setSelfPublic(null);
    setLastUpdateAt(null);
  }, []);

  const others = useMemo(
    () =>
      Array.from(records.values()).filter(
        (r) => r.publicId !== selfIdRef.current
      ),
    [records, selfId]
  );

  return {
    connection,
    selfId,
    others,
    selfPublic,
    lastUpdateAt,
    notice,
    publish,
    stop,
  };
}
