import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LatLng,
  maskLocation,
  PRESENCE_HEARTBEAT_MS,
  PresenceRecord,
  SHARE_MAX_DURATION_MS,
} from "@safesips/shared";
import { createSocket, type AppSocket } from "./socket";

export type ConnectionState = "connecting" | "connected" | "disconnected";

function activeRecords(map: Map<string, PresenceRecord>): PresenceRecord[] {
  const now = Date.now();
  return Array.from(map.values()).filter((r) => r.expiresAt > now);
}

/**
 * Owns the socket connection and presence state on mobile.
 * Exact coordinates passed to `publish` are masked locally; only the masked
 * center is emitted. While sharing, a heartbeat keeps presence visible to all
 * connected users. Sharing auto-stops after 24 hours.
 */
export function usePresence() {
  const socketRef = useRef<AppSocket | null>(null);
  const selfIdRef = useRef<string | null>(null);
  const maskedRef = useRef<LatLng | null>(null);
  const shareStartedAtRef = useRef<number | null>(null);
  const sharingRef = useRef(false);

  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [selfId, setSelfId] = useState<string | null>(null);
  const [records, setRecords] = useState<Map<string, PresenceRecord>>(
    new Map()
  );
  const [selfPublic, setSelfPublic] = useState<LatLng | null>(null);
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const stopLocal = useCallback(() => {
    sharingRef.current = false;
    maskedRef.current = null;
    shareStartedAtRef.current = null;
    setSelfPublic(null);
    setLastUpdateAt(null);
  }, []);

  const emitMasked = useCallback((masked: LatLng) => {
    setSelfPublic(masked);
    setLastUpdateAt(Date.now());
    setNotice(null);
    socketRef.current?.emit("location:update", masked);
  }, []);

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnection("connected");
      setNotice(null);
      // Re-publish immediately on reconnect so presence returns without
      // waiting for the next heartbeat (~PRESENCE_HEARTBEAT_MS).
      if (sharingRef.current && maskedRef.current) {
        emitMasked(maskedRef.current);
      }
    });
    socket.on("disconnect", () => setConnection("disconnected"));
    socket.io.on("reconnect_attempt", () => setConnection("connecting"));
    socket.on("connect_error", (err) => {
      setConnection("disconnected");
      setNotice(
        err.message === "unauthorized"
          ? "Server rejected the connection."
          : "Could not reach the SafeSips server."
      );
    });

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
    socket.on("error:notice", ({ code, message }) => {
      setNotice(message);
      if (code === "share_expired") stopLocal();
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, [stopLocal, emitMasked]);

  useEffect(() => {
    const id = setInterval(() => {
      setRecords((prev) => {
        const live = activeRecords(prev);
        if (live.length === prev.size) return prev;
        return new Map(live.map((r) => [r.publicId, r]));
      });
    }, 10_000);
    return () => clearInterval(id);
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
    socketRef.current?.emit("location:stop");
    stopLocal();
  }, [stopLocal]);

  useEffect(() => {
    if (!sharingRef.current || !maskedRef.current) return;
    const id = setInterval(() => {
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
    return () => clearInterval(id);
  }, [selfPublic, emitMasked, stop]);

  const others = useMemo(
    () =>
      activeRecords(records).filter(
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
