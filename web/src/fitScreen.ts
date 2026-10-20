/**
 * iPhone Home Screen apps with the translucent status bar report a viewport
 * that is short by about the status-bar height (window.innerHeight and
 * 100%/100dvh/fixed inset 0 all stop early), leaving an empty band at the
 * bottom. There the app really owns the whole screen, so size the shell to
 * the screen instead (`--app-height`, used by `.shell`).
 *
 * iOS standalone only: on Android, screen.height also counts the system bars,
 * so the same maths would push content under the navigation bar.
 */
export function fitStandaloneScreen(): void {
  const nav = navigator as Navigator & { standalone?: boolean };
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = nav.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true;
  if (!isIos || !standalone) return;

  const root = document.documentElement;
  const update = () => {
    // screen.width/height don't swap on rotation; pick by orientation.
    const portrait = window.innerHeight >= window.innerWidth;
    const screenH = portrait
      ? Math.max(screen.width, screen.height)
      : Math.min(screen.width, screen.height);
    const gap = screenH - window.innerHeight;
    // Only the status-bar-sized shortfall; anything else, trust the viewport.
    if (gap > 0 && gap <= 80) root.style.setProperty("--app-height", `${screenH}px`);
    else root.style.removeProperty("--app-height");
  };
  update();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", () => setTimeout(update, 300));
}
