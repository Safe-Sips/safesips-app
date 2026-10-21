import type { IncomingHttpHeaders } from "node:http";
import { config } from "./config.js";

/**
 * The client's IP address behind the hosting proxy, used for per-IP limits
 * (never stored raw). Both Express requests and Socket.io handshakes use
 * this, so their limits agree.
 *
 *  - CLIENT_IP_HEADER (e.g. "cf-connecting-ip" on Render, which sits behind
 *    Cloudflare) names a header the proxy sets to the real client address.
 *    Only set it when every request passes through that proxy, otherwise
 *    clients could spoof it.
 *  - Otherwise the last X-Forwarded-For entry (added by the one trusted proxy,
 *    matching Express's `trust proxy = 1`).
 *  - Otherwise the TCP peer address.
 *
 * Without this, sockets saw the proxy's address for everyone, so the
 * per-IP connection cap applied to all users together.
 */
export function clientIpFrom(headers: IncomingHttpHeaders, peer: string | undefined): string {
  if (config.clientIpHeader) {
    const v = headers[config.clientIpHeader];
    const ip = (Array.isArray(v) ? v[0] : v)?.split(",")[0]?.trim();
    if (ip) return ip;
  }
  const xff = headers["x-forwarded-for"];
  const list = (Array.isArray(xff) ? xff.join(",") : xff ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length > 0) return list[list.length - 1];
  return peer ?? "0.0.0.0";
}
