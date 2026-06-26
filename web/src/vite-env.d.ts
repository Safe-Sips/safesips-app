/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Presence server + default REST API origin. */
  readonly VITE_SERVER_URL?: string;
  /** Optional REST API origin override (defaults to VITE_SERVER_URL). */
  readonly VITE_API_URL?: string;
  /** Optional Cloudflare Turnstile site key (enables the captcha widget). */
  readonly VITE_TURNSTILE_SITEKEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
