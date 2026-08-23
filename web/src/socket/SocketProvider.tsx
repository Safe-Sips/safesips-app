import { useAuth as useClerkAuth } from "@clerk/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/AuthContext";
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
  const { logout } = useAuth();
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

    const onConnect = () => setConnection("connected");
    const onDisconnect = () => setConnection("disconnected");
    const onReconnectAttempt = () => setConnection("connecting");
    const onConnectError = (err: Error) => {
      setConnection("disconnected");
      if (err.message === "unauthorized") {
        void logout();
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
      s.disconnect();
      setSocket(null);
    };
  }, [isSignedIn, getToken, logout]);

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
