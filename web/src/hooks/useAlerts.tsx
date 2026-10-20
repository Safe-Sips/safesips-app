import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { CheckinAlertDTO } from "@safesips/shared";
import { api } from "../api";
import { useSocket } from "../socket/SocketProvider";

/**
 * Alerts this user received as someone's emergency contact. Shared by the nav
 * badge, the app-wide banner and the Alerts page; refreshed live over the
 * socket (`alert:new`) and when the tab regains focus.
 */
interface AlertsApi {
  alerts: CheckinAlertDTO[];
  unread: number;
  refresh: () => Promise<void>;
  acknowledge: (id: string) => Promise<void>;
}

const AlertsContext = createContext<AlertsApi | null>(null);

export function AlertsProvider({ children }: { children: ReactNode }) {
  const { socket } = useSocket();
  const [alerts, setAlerts] = useState<CheckinAlertDTO[]>([]);
  const [unread, setUnread] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const r = await api.alerts();
      setAlerts(r.alerts);
      setUnread(r.unread);
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    const onNew = () => void refresh();
    socket.on("alert:new", onNew);
    socket.on("connect", onNew);
    return () => {
      socket.off("alert:new", onNew);
      socket.off("connect", onNew);
    };
  }, [socket, refresh]);

  const acknowledge = useCallback(async (id: string) => {
    const r = await api.ackAlert(id);
    setAlerts(r.alerts);
    setUnread(r.unread);
  }, []);

  const value = useMemo(() => ({ alerts, unread, refresh, acknowledge }), [alerts, unread, refresh, acknowledge]);
  return <AlertsContext.Provider value={value}>{children}</AlertsContext.Provider>;
}

export function useAlerts(): AlertsApi {
  const ctx = useContext(AlertsContext);
  if (!ctx) throw new Error("useAlerts must be used inside AlertsProvider");
  return ctx;
}
