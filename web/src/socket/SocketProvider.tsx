import { useAuth as useClerkAuth } from "@clerk/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createSocket, type AppSocket } from "../socket";

export type ConnectionState = "connecting" | "connected" | "disconnected";

interface SocketContextValue {
  socket: AppSocket | null;
  connection: ConnectionState;
}

const SocketContext = createContext<SocketContextValue>({
  socket: null,
  connection: "connecting",
});

/**
 * Owns the single authenticated Socket.io connection. Mounted inside the
 * authenticated shell after Clerk sign-in.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { isSignedIn, getToken } = useClerkAuth();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  useEffect(() => {
    if (!isSignedIn) {
      setSocket(null);
      return;
    }
    const s = createSocket(() => getToken());
    setSocket(s);
    setConnection("connecting");

    // A handshake the server rejects isn't retried by Socket.io, and it can be
    // transient (the API restarting, Clerk's keys not loaded yet), so retry
    // with backoff instead of signing the user out. A real sign-out shows up
    // through Clerk (isSignedIn) and the REST API's 401s.
    let retryTimer: number | undefined;
    let retryDelay = 2_000;
    const onConnect = () => {
      retryDelay = 2_000;
      setConnection("connected");
    };
    const onDisconnect = () => setConnection("disconnected");
    const onReconnectAttempt = () => setConnection("connecting");
    const onConnectError = (err: Error) => {
      setConnection("disconnected");
      if (err.message === "unauthorized") {
        window.clearTimeout(retryTimer);
        retryTimer = window.setTimeout(() => {
          setConnection("connecting");
          s.connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 60_000);
      }
    };

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.io.on("reconnect_attempt", onReconnectAttempt);
    s.on("connect_error", onConnectError);

    return () => {
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.io.off("reconnect_attempt", onReconnectAttempt);
      s.off("connect_error", onConnectError);
      window.clearTimeout(retryTimer);
      s.disconnect();
      setSocket(null);
    };
  }, [isSignedIn, getToken]);

  const value = useMemo<SocketContextValue>(
    () => ({ socket, connection }),
    [socket, connection]
  );

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
}

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
