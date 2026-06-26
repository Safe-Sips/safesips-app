import { useEffect, useRef } from "react";

interface CaptchaWidgetProps {
  onToken: (token: string | null) => void;
}

interface TurnstileApi {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string;
      callback: (token: string) => void;
      "error-callback"?: () => void;
      "expired-callback"?: () => void;
    }
  ) => string;
  remove: (id: string) => void;
}

/**
 * Cloudflare Turnstile widget. Renders only when VITE_TURNSTILE_SITEKEY is set;
 * otherwise it renders nothing and the server falls back to its built-in
 * throttle + email verification (pluggable anti-bot).
 */
export default function CaptchaWidget({ onToken }: CaptchaWidgetProps) {
  const siteKey = import.meta.env.VITE_TURNSTILE_SITEKEY;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let widgetId: string | undefined;
    const el = ref.current;

    const render = () => {
      const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (ts && el) {
        widgetId = ts.render(el, {
          sitekey: siteKey,
          callback: (token) => onToken(token),
          "error-callback": () => onToken(null),
          "expired-callback": () => onToken(null),
        });
      }
    };

    const existing = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (!existing) {
      const script = document.createElement("script");
      script.src =
        "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = render;
      document.head.appendChild(script);
    } else {
      render();
    }

    return () => {
      const ts = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
      if (ts && widgetId) {
        try {
          ts.remove(widgetId);
        } catch {
          // ignore
        }
      }
    };
  }, [siteKey, onToken]);

  if (!siteKey) return null;
  return <div className="captcha-widget" ref={ref} />;
}
