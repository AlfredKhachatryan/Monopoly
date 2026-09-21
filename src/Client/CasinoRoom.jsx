// The casino floor: one full-screen felt frame, shared by the two components
// that are allowed to put something on it.
//
// WHY THERE IS A SHARED FRAME AT ALL. Landing on cell 13 takes over the whole
// phone — felt, brass, the chosen machine big at the top, the controls at the
// bottom — and the spin is supposed to happen IN PLACE, on the machine the
// player was just looking at. But the server goes back to phase 'act' in the
// same response that carries the result, so CasinoPanel (mounted only while
// phase === 'casino') is unmounted the instant the bet resolves. It cannot
// animate anything: it is gone before there is anything to animate. The result
// is replayed by CasinoResult, a different component, mounted somewhere else.
//
// So continuity is built out of two things, both in this file:
//
//   1. <CasinoRoom>, the frame. Header, a stage that holds the machine, a foot.
//      CasinoPanel fills the foot with the controls; CasinoResult fills it with
//      the verdict. Same grid, same paddings, same machine component at the same
//      size — provided the two feet are the same height, which is what
//      `footHeight` is for (the panel measures its own and hands it over).
//
//   2. `bridge`, a tiny store. The moment the bettor presses SPIN the panel
//      publishes {game, bet, colour, cash, footHeight}. CasinoResult is mounted
//      for the whole life of the screen (ClientScreen hands it a null event
//      when there is nothing to show) and subscribes; it puts up the identical
//      frame, machine idle, IMMEDIATELY — while the request is still in flight
//      and the panel is still underneath it. When the panel is unmounted a
//      moment later nothing visible changes, because what the player is
//      looking at was never the panel's DOM in the first place; and when the
//      result event arrives the machine that starts to spin is the very same
//      element that was sitting there idle. No frame in which the ordinary
//      screen shows through, no second machine sliding in.
//
//      The bridge carries what the player CHOSE, never an outcome. There is no
//      outcome on this side of the wire until the server sends one.
//
// WHERE IT IS MOUNTED, AND WHY IT STAYS PRESSABLE. The frame is portalled into
// the `[data-client]` root — not into <body>, because every token it reads
// (--f-display, --f-body, the focus colour) is scoped to that element and a
// body-level portal would lose them all. It is `position: fixed`, which is safe
// there: nothing between the root and the viewport carries a transform, a
// filter or `contain`, so the viewport is its containing block. And it lands
// OUTSIDE ClientScreen's `.stage`, which matters more than it sounds: the stage
// is the block ClientScreen switches `inert` while a sheet, a card, an offer or
// the casino replay is up, and CasinoPanel is rendered deep inside it. `inert`
// is a property of the DOM tree, not the React tree, so a portal that lands
// outside the stage is untouched by it — the takeover can always be pressed,
// whatever ClientScreen has decided about the screen underneath.
//
// The host is found by walking up from an anchor rendered in place
// (`closest('[data-client]')`), not by a document-wide query, so it is the root
// this component actually lives under. Until the anchor has been measured —
// the first render, and any render without a DOM — the frame renders inline,
// where `position: fixed` still makes it cover the screen; the layout effect
// moves it into the portal before the browser has painted anything.

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Spade } from "lucide-react";
import c from "./casino.module.css";

// ---- the bridge --------------------------------------------------------------

let pending = null;
const listeners = new Set();

function publish(next) {
  if (pending === next) return;
  pending = next;
  listeners.forEach((fn) => fn());
}

export const bridge = {
  get: () => pending,
  // For a render without a DOM: there is never a bet in flight there.
  getServer: () => null,
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  // The bettor pressed the button. `at` lets anything reading it tell a fresh
  // hand-over from one that was somehow left behind.
  open(bet) {
    publish({ ...bet, at: Date.now(), goneAt: null });
  },
  // The panel went away. If that was the server moving on, the result event is
  // already on its way; if it was anything else (the player left, a resync took
  // the block away) nothing will ever come, and CasinoResult's watchdog uses
  // this timestamp to take the frame down rather than strand it.
  panelGone() {
    if (pending && pending.goneAt == null) publish({ ...pending, goneAt: Date.now() });
  },
  clear() {
    publish(null);
  },
};

// ---- the host ----------------------------------------------------------------

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

// Returns [anchor element to render in place, host element or null].
export function useCasinoHost() {
  const anchor = useRef(null);
  const [host, setHost] = useState(null);
  useIsoLayoutEffect(() => {
    const root = anchor.current?.closest?.("[data-client]") ?? null;
    setHost(root);
  }, []);
  return [anchor, host];
}

// ---- the frame ---------------------------------------------------------------

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

export default function CasinoRoom({
  host,
  label,
  // "dialog" for the bettor's takeover, "alertdialog" for the replay.
  role = "dialog",
  // What sits at the right of the header: the bettor's cash, or who is betting.
  aside = null,
  sub = null,
  machine,
  foot,
  footRef,
  footHeight = null,
  // Fade in (a spectator's replay arriving over their ordinary screen) or
  // simply be there (the bettor, for whom this is the same screen as before).
  enter = "none",
  leaving = false,
  // Keep Tab inside the frame. The takeover sits over a screen full of buttons
  // the server would refuse, and ClientScreen does not make that screen inert
  // for it (it has no reason to: as far as it knows this is a panel).
  trap = false,
  onClick,
  tone = null,
}) {
  const root = useRef(null);

  useEffect(() => {
    if (!trap) return undefined;
    const el = root.current;
    if (!el) return undefined;
    // Land inside the frame, on the frame itself: no control is pre-selected
    // for the player, and a screen reader announces the dialog's own label.
    el.focus({ preventScroll: true });
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const items = Array.from(el.querySelectorAll(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const at = document.activeElement;
      if (!el.contains(at)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (at === first || at === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [trap, host]);

  const frame = (
    <div
      ref={root}
      className={c.room}
      role={role}
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      data-enter={enter}
      data-leaving={leaving ? "1" : undefined}
      data-tone={tone ?? undefined}
      onClick={onClick}
    >
      <header className={c.roomHead}>
        <span className={c.roomMark} aria-hidden="true">
          <Spade size={20} strokeWidth={2.4} />
        </span>
        <div className={c.roomTitle}>
          <strong>Casino</strong>
          {sub && <span>{sub}</span>}
        </div>
        {aside && <div className={c.roomAside}>{aside}</div>}
      </header>

      {/* The stage is a size container: every machine sizes itself from the
          box it is given (cqw / cqh), so on a short phone it is the MACHINE
          that gives up height — the stage is the only flexible row in the
          grid — and the controls in the foot are never clipped. */}
      <div className={c.roomStage}>{machine}</div>

      <div
        ref={footRef}
        className={c.roomFoot}
        style={footHeight ? { minHeight: `${footHeight}px` } : undefined}
      >
        {foot}
      </div>
    </div>
  );

  return host ? createPortal(frame, host) : frame;
}
