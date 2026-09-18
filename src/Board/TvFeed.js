// "Did this just happen, or am I only reading the row?"
//
// The TV has no local action of its own: everything it knows arrives as a whole
// `game` object — from the first fetch, from a refresh, or from a Realtime
// push. A card that flies in, a die that tumbles and a row that slides down are
// only honest for the third case. Replaying the last action after an F5 shows a
// card for something that happened three turns ago.
//
// So the seq of the first `game` this hook ever sees is adopted SILENTLY, and
// only a seq that moves past it afterwards produces a batch. `null` until then,
// which is exactly the "nothing transient on first mount" the design asks for.
//
// A room that is still loading arrives as `{}` (seq 0 / missing). That is not a
// snapshot worth adopting — the real row lands a moment later with seq 42 and
// would otherwise look like 42 things happening at once — so seq <= 0 is
// ignored until a real one shows up. A brand new room genuinely sits at seq 0
// and its first action (seq 1) is genuinely live, which this still gets right.

import { useEffect, useState } from "react";

// The batch is derived DURING RENDER, not in an effect, and that matters now
// that the reveal buffer (src/Client/useReveal.js) hangs off it.
//
// An effect — passive or layout — would hand the batch over one commit LATE:
// the commit that carried the new `game` has already happened, so everything
// below it has already reacted to the new row (the cash count-up has set off
// towards the new balance, the tokens have been told to fly) before the buffer
// ever hears about the roll. Deriving it while rendering is React's documented
// "adjust state when props change" pattern: the setState re-renders this
// component immediately, throws the half-done output away, and `game` and its
// feed reach the screen in the SAME commit — which is the only way the phone
// and the TV can hold a roll back identically.
export function useTvFeed(game) {
  const seq = Number(game?.seq) || 0;
  const [seen, setSeen] = useState(null);
  const [feed, setFeed] = useState(null);

  if (seen === null) {
    // The first real snapshot is adopted without a sound. A room that is still
    // loading arrives as {} (seq 0 / missing) and is not worth adopting — the
    // real row lands a moment later with seq 42 and would otherwise look like
    // 42 things happening at once. A brand new room genuinely sits at seq 0 and
    // its first action (seq 1) is genuinely live, which this still gets right.
    if (seq > 0) setSeen(seq);
  } else if (seq !== seen) {
    setSeen(seq);
    // A new room (or a reset) rewinds the counter: re-baseline, stay quiet.
    if (seq > seen) {
      setFeed({
        seq,
        actor: game?.actor ?? null,
        events: Array.isArray(game?.events) ? game.events : [],
      });
    }
  }
  // A new object with the same seq is the same batch (a refetch of an unchanged
  // row) and is ignored above, so nothing here ever replays an overlay.

  return feed;
}

// prefers-reduced-motion, live. The TV is a long-running page and the setting
// can flip under it, so this listens rather than reading once.
export function useTvReduce() {
  const [reduce, setReduce] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return reduce;
}
