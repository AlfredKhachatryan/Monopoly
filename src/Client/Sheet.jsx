import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";
import { useReducedMotion } from "framer-motion";
import { m, AnimatePresence, ease } from "../Components/Motion";
import sh from "./sheet.module.css";

// Any element inside the sheet that Tab should be allowed to land on.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Bottom sheet. Tap the backdrop or the close button to dismiss; there is no
// drag gesture because LazyMotion here loads domAnimation only, which leaves
// the drag engine out of the bundle on purpose.
//
// Positioning: the scrim and the sheet itself are `position: absolute;
// inset/left/right/bottom: 0` rather than `fixed`, so they are contained by
// the nearest positioned ancestor instead of the viewport. That ancestor is
// `.app` in screen.module.css — ClientScreen renders these as siblings of
// `.stage` inside it — which is `position: relative` and `overflow: clip`,
// so the scrim covers exactly the app and nothing else, and the sheet is
// automatically clipped to it at whatever width the app happens to be.
export default function Sheet({ open, title, onClose, children }) {
  const titleId = useId();
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const restoreRef = useRef(null);
  const reduced = useReducedMotion();

  // Move focus in on open, and put it back where it was on close.
  //
  // Focus lands on the dialog BOX, not on the close button. Both satisfy the
  // a11y contract — role=dialog + aria-labelledby means a screen reader reads
  // the sheet's title either way — but putting it on the ✕ lit that button up
  // the instant any sheet opened, including for someone who had just tapped
  // with a thumb. (The ring was Bootstrap's `button:focus`, not :focus-visible;
  // screen.module.css takes that rule off now. This keeps the ✕ from being
  // singled out at all: nothing is "selected" when a sheet opens, and the first
  // Tab still moves to the ✕ and rings it properly for the keyboard.)
  //
  // `preventScroll` on BOTH moves, and it is not optional. The sheet mounts
  // translated `y: 100%`, i.e. a whole sheet-height below the bottom of the
  // client root, and this focus lands one frame later while the slide is still
  // running. A plain focus() scrolls the focused element into view, and an
  // `overflow: hidden` box is still programmatically scrollable, so the client
  // root scrolled itself down by 18-42px (measured: 37px for My deeds and 42px
  // for Players at 1280x800): the entire screen jumped up for the length of the
  // animation, clipping the player's name off the top and pulling the scrim's
  // bottom edge up off the floor of the screen. `.app` in screen.module.css is
  // `overflow: clip` now so there is no scroll container left to move, and this
  // flag keeps the document itself still on top of that.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const raf = requestAnimationFrame(() => sheetRef.current?.focus({ preventScroll: true }));
    return () => {
      cancelAnimationFrame(raf);
      const el = restoreRef.current;
      if (el && typeof el.focus === "function") el.focus({ preventScroll: true });
    };
  }, [open]);

  function handleKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
    const root = sheetRef.current;
    if (!root) return;
    const focusables = Array.from(root.querySelectorAll(FOCUSABLE));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    // Focus starts on the box itself, which is `tabindex="-1"` and so is not in
    // `focusables`. Tabbing forward from there needs no help — the browser
    // walks into the sheet's own contents and lands on the ✕. Shift+Tab from
    // there would walk OUT the top of the dialog instead, so it is sent round
    // to the last control, which is what the trap does at either end anyway.
    if (document.activeElement === root) {
      if (e.shiftKey) {
        e.preventDefault();
        last.focus();
      }
      return;
    }
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  // "Reduce motion" turns the slide off but not an opacity animation, which is
  // how the two used to fall out of step: the sheet snapped into place while
  // the scrim was still only a third of the way in, and on the way out it
  // vanished instantly and left a dark veil lying over a sheet-less screen for
  // another 165ms. Reduced means reduced for both — the pair appears and
  // disappears together, in one frame.
  const enter = { duration: reduced ? 0 : 0.28, ease };
  const leave = { duration: reduced ? 0 : 0.18, ease };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* `pointerEvents: none` in `exit` is what lets the screen underneath
              be used again the moment the sheet is dismissed. AnimatePresence
              keeps both of these mounted for the whole 180ms exit, and the
              scrim is `inset: 0`, so without this it went on swallowing every
              tap after the sheet was already on its way out: a second tap on
              the same nav button — the natural "oops, reopen that" — landed on
              the scrim instead and did nothing at all. Measured before the fix:
              elementFromPoint over the nav button returned the backdrop at
              close+60ms and close+120ms. */}
          <m.div
            key="scrim"
            className={sh.backdrop}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: enter }}
            exit={{ opacity: 0, pointerEvents: "none", transition: leave }}
          />
          <m.section
            key="sheet"
            ref={sheetRef}
            className={sh.sheet}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            /* -1: focusable from code on open, never a Tab stop of its own. */
            tabIndex={-1}
            onKeyDown={handleKeyDown}
            initial={{ y: "100%" }}
            animate={{ y: 0, transition: enter }}
            exit={{ y: "100%", pointerEvents: "none", transition: leave }}
          >
            <div className={sh.grip} aria-hidden="true" />
            <header className={sh.head}>
              <h2 id={titleId} className={sh.title}>
                {title}
              </h2>
              <button ref={closeRef} type="button" className={sh.close} onClick={onClose} aria-label="Close">
                <X size={20} />
              </button>
            </header>
            <div className={sh.body}>{children}</div>
          </m.section>
        </>
      )}
    </AnimatePresence>
  );
}
