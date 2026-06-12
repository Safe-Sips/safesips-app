import { io, Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@safesips/shared";

const SERVER_URL =
  import.meta.env.VITE_SERVER_URL ?? "http://localhost:4000";

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function createSocket(): AppSocket {
  return io(SERVER_URL, {
    transports: ["websocket"],
    autoConnect: true,
  });
}
