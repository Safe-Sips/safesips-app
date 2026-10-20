/**
 * iPhone Home Screen apps with the translucent status bar lay the page out
 * short by about the status-bar height (100%/100dvh/fixed inset 0 all stop
 * early — and window.innerHeight can't be trusted to show it), leaving an
 * empty band at the bottom. There the app always owns the whole screen, so
 * size the shell to the screen (`--app-height`, used by `.shell`).
 *
 * iPhone standalone only: on Android, screen.height also counts the system bars,
 * so the same maths would push content under the navigation bar.
 */
export function fitStandaloneScreen(): void {
  const nav = navigator as Navigator & { standalone?: boolean };
  // iPhone only: on iPad the app can be a split-view / Stage Manager window
  // smaller than the screen.
  const isIos = /iPhone|iPod/.test(navigator.userAgent);
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
    root.style.setProperty("--app-height", `${screenH}px`);
  };
  update();
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", () => setTimeout(update, 300));
}
