import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

/**
 * SafeSips notifications on this device (Web Push via our service worker):
 * check-in prompts, and alerts when someone you protect misses a check-in.
 *
 *  - "needs-install": iPhone/iPad Safari — Apple only allows web push once the
 *    site is added to the Home Screen (iOS 16.4+).
 *  - "unavailable": no service worker (e.g. local development build).
 */
export type PushStatus =
  | "loading"
  | "unsupported"
  | "needs-install"
  | "unavailable"
  | "denied"
  | "off"
  | "on";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

export function usePushNotifications() {
  const [status, setStatus] = useState<PushStatus>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setStatus(isIos() && !isStandalone() ? "needs-install" : "unsupported");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setStatus("unavailable");
        return;
      }
      if (Notification.permission === "denied") {
        setStatus("denied");
        return;
      }
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        // Re-sync: keeps working after a server reset and follows whoever is
        // signed in on this browser.
        void api.pushSubscribe(sub.toJSON()).catch(() => undefined);
        setStatus("on");
      } else {
        setStatus("off");
      }
    } catch {
      setStatus("unsupported");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        setStatus("unavailable");
        return;
      }
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "off");
        return;
      }
      const key = urlBase64ToUint8Array((await api.pushPublicKey()).publicKey);
      let sub = await reg.pushManager.getSubscription();
      // A subscription made with an old server key can't receive pushes.
      if (sub && !sameKey(sub.options.applicationServerKey, key)) {
        await sub.unsubscribe();
        sub = null;
      }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api.pushSubscribe(sub.toJSON());
      setStatus("on");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn on notifications.");
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api.pushUnsubscribe(sub.endpoint).catch(() => undefined);
        await sub.unsubscribe();
      }
      setStatus("off");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't turn off notifications.");
    } finally {
      setBusy(false);
    }
  }, []);

  return { status, busy, error, enable, disable };
}
