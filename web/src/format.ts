/** Compact relative time, e.g. "5m ago". */
export function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

/** Compact countdown to a future timestamp, e.g. "in 7m". */
export function timeUntil(ts: number): string {
  const s = Math.floor((ts - Date.now()) / 1000);
  if (s <= 0) return "now";
  const m = Math.floor(s / 60);
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
