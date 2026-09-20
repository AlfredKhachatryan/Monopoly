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
//
// ADOPTING A ROW AND PLAYING ITS BEAT ARE TWO DIFFERENT JOBS
// ---------------------------------------------------------
// They used to be one piece of state here, and that was a bug. `seen` answered
// both "which seq am I holding?" and "which seq have I announced?", which is
// only the same question while every seq arrives exactly once, by one path.
// It does not.
//
// A resync (BoardScreen's `silent`) adopts a row without announcing it, and
// there are a lot of those: the 20s heartbeat, window focus, visibilitychange,
// pageshow, online, and the channel resubscribing after a drop. Any one of them
// can resolve in the window between the server committing an action and that
// action's Realtime push reaching this screen — a window that is wide on a real
// socket, where the push is the SLOWEST of the paths and not, as the offline
// mock long pretended, the fastest. When it does, `seen` is already at that seq
// by the time the live push arrives, the old `seq !== seen` guard read false,
// and the whole beat went in the bin: no dice tumbling onto the rolled faces,
// no Chance card, no doubles or jail FX, no coins crossing the screen, no fresh
// row sliding into Latest. The board was CORRECT and completely silent, which
// on a screen whose only job is to narrate is the worst of both.
//
// So `shown` is kept apart from `seen`, and a live arrival of the seq we are
// already holding is still allowed to hand its events over — once, whichever
// way round the two deliveries land. This is the same rule, and the same
// reasoning, as the `shownSeq`/`owed` rescue in src/Hooks/useGameRoom.js; the
// phone and the TV get this wrong or right together.

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
// `silent` is the resync case (BoardScreen): this row arrived because the TV
// asked for it again after a drop, not because it just happened. The seq is
// adopted so the NEXT live action is still news, and nothing is announced —
// which is the difference between a board that catches up and a board that
// replays three turns at the viewer the moment the Wi-Fi comes back.
export function useTvFeed(game, silent = false) {
  const seq = Number(game?.seq) || 0;
  // Which seq this screen is holding…
  const [seen, setSeen] = useState(null);
  // …and which seq it has actually told the room about. See the note above.
  const [shown, setShown] = useState(null);
  // The `game` object that carried `seen`. Identity, not value: it is the only
  // honest way to tell "the same row, delivered again" from "the same row, but
  // this is a different delivery of it" — and the rescue below must only fire
  // on a genuine arrival, never on a re-render that merely flipped `silent`.
  // Without it the three callers disagree about WHEN: BoardScreen's copy reads
  // the raw row, TvCenter's and TvSide's read the row the reveal buffer is
  // holding, so the flag turns false for them while the dice are still in the
  // air and the card would be dealt over a tumbling die.
  const [adopted, setAdopted] = useState(null);
  const [feed, setFeed] = useState(null);

  // Stamping `shown` is part of announcing, never separable from it: the two
  // call sites below both go through here so "announced" cannot drift from
  // what was actually handed over.
  const announce = () => {
    setShown(seq);
    setFeed({
      seq,
      actor: game?.actor ?? null,
      events: Array.isArray(game?.events) ? game.events : [],
    });
  };

  if (seen === null) {
    // The first real snapshot is adopted without a sound. A room that is still
    // loading arrives as {} (seq 0 / missing) and is not worth adopting — the
    // real row lands a moment later with seq 42 and would otherwise look like
    // 42 things happening at once. A brand new room genuinely sits at seq 0 and
    // its first action (seq 1) is genuinely live, which this still gets right.
    //
    // `shown` is deliberately left null rather than baselined to this seq: the
    // very first fetch can land in the same window as the Realtime push for an
    // action that is genuinely happening right now, and that push should still
    // be allowed to speak.
    if (seq > 0) {
      setSeen(seq);
      setAdopted(game);
    }
  } else if (seq > seen) {
    // The ordinary case: the room moved on. Live means news; a resync means the
    // seq is adopted so the NEXT action is still news, and nothing is said.
    setSeen(seq);
    setAdopted(game);
    if (!silent) announce();
  } else if (seq < seen) {
    // A new room (or a reset) rewinds the counter: re-baseline, stay quiet.
    // `shown` goes back to null with it, because a seq from the old room says
    // nothing about what this one has announced — leaving 42 there would sit in
    // front of the new room's first few actions and block the rescue below.
    setSeen(seq);
    setAdopted(game);
    setShown(null);
  } else if (!silent && seq > 0 && game !== adopted && (shown === null || seq > shown)) {
    // THE RESCUE. This row is one a silent resync already adopted, and here it
    // comes again — a fresh delivery (a different object), live this time. The
    // state needs nothing, both copies say the same thing; the BEAT is what was
    // never played, so hand the events over now. `shown` makes that happen
    // exactly once however the two deliveries were ordered: live-then-resync is
    // caught by the branch above and the resync says nothing, resync-then-live
    // is caught here.
    //
    // Deliberately only for the seq being held. A live row genuinely BEHIND the
    // screen is not rescued — its events describe a state the room has already
    // moved past. And a seq that only ever arrives silently (the socket is
    // dead, a refetch is the sole delivery) is never announced at all: snapping
    // to state in silence is the intended behaviour there, not a bug.
    setAdopted(game);
    announce();
  }
  // Anything else — the same object rendered again, a silent refetch of a row
  // already held, a seq already announced — falls through without a word, so
  // nothing here ever replays an overlay.

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
