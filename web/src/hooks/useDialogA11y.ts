import { useEffect, useRef } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Keyboard/screen-reader behaviour for a modal dialog:
 *  - moves focus into the dialog when it opens (the element marked
 *    `data-autofocus`, else the first focusable one),
 *  - keeps Tab / Shift+Tab inside it,
 *  - calls `onEscape` on Escape (omit it for dialogs that must be answered),
 *  - returns focus to whatever was focused before, when it closes.
 *
 * Attach the returned ref to the dialog card (not the backdrop).
 */
export function useDialogA11y<T extends HTMLElement>(
  open: boolean,
  onEscape?: () => void
) {
  const ref = useRef<T>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const node = ref.current;
    if (node) {
      const target =
        node.querySelector<HTMLElement>("[data-autofocus]") ??
        node.querySelector<HTMLElement>(FOCUSABLE) ??
        node;
      if (target === node && !node.hasAttribute("tabindex")) node.tabIndex = -1;
      target.focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onEscapeRef.current) {
        e.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const items = Array.from(
        ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  return ref;
}
