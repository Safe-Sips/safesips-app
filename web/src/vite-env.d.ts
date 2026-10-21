/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Presence server + default REST API origin. */
  readonly VITE_SERVER_URL?: string;
  /** Optional REST API origin override (defaults to VITE_SERVER_URL). */
  readonly VITE_API_URL?: string;
  /** Optional Cloudflare Turnstile site key (enables the captcha widget). */
  readonly VITE_TURNSTILE_SITEKEY?: string;
  readonly VITE_CLERK_PUBLISHABLE_KEY: string;
  /** Map tile URL template, e.g. a MapTiler/Stadia URL with your key. */
  readonly VITE_MAP_TILE_URL?: string;
  /** HTML attribution the tile provider requires. */
  readonly VITE_MAP_TILE_ATTRIBUTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
