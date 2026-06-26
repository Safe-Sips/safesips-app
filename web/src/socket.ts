import { io, Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@safesips/shared";

const configured =
  import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

if (import.meta.env.PROD && configured.startsWith("http://")) {
  // eslint-disable-next-line no-console
  console.error(
    "VITE_SERVER_URL must use https:// (or wss://) in production deployments."
  );
}

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Create an authenticated socket. The JWT is sent in the handshake `auth`
 * payload; the server rejects connections without a valid token.
 */
export function createSocket(token: string): AppSocket {
  return io(configured, {
    transports: ["websocket"],
    autoConnect: true,
    auth: { token },
  });
}
